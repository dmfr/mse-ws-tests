
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';
import * as path from 'path';

import { Worker } from "worker_threads" ;

import h264reader from './server-lib-h264reader.js' ;
import adtsReader from './server-lib-adtsReader.js' ;

import { createRequire } from "module";
const _config = createRequire(import.meta.url)("./server-config.json");
const pathSave = _config.filestore_path ;

let programId = 'ed97b994-0098-404b-a995-8455e952ecb5' ;
if( workerData && workerData.programId ) {
	programId = workerData.programId ;
}

async function util_timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function getRecordDesc(fileId) {
	return new Promise(function (resolve, reject) {
		const worker = new Worker("./server-fileworker-list.js", {workerData:{fileId:fileId}});
		worker.on("message", function(message){
			if( message.length == 1 ) {
				resolve(message[0]) ;
			}
		});
		worker.on("error", function(){
			
		});
		worker.on("exit", (code) => {
			if (code !== 0) {
				//reject(new Error(`stopped with exit code ${code}`));
			}
		});
	});
}

async function buildIndexVideo( videoreader ) {
	let obj = {} ;
	
	try {
		const {width,height} = await videoreader.getSPSdimensions() ;
		obj['size'] = {width,height} ;
	} catch(e) {}
	
	const offsets = [] ;
	const { newOffset, data } = await videoreader.buildFromOffset(0) ;
	offsets.push(newOffset-data.length) ;
	let offset = 0 ;
	while(true) {
		const { newOffset, data } = await videoreader.buildFromOffset(offset) ;
		if( data == null ) {
			break ;
		}
		offset = newOffset ;
		offsets.push(offset) ;
	}
	obj['offsets'] = offsets ;
	
	return obj ;
}
async function buildIndexAudio( audioreader ) {
	let obj = {} ;
	
	const offsets = [] ;
	const { newOffset, data } = await audioreader.buildFromOffset(0) ;
	offsets.push(newOffset-data.length) ;
	let offset = 0 ;
	while(true) {
		const { newOffset, data } = await audioreader.buildFromOffset(offset) ;
		if( data == null ) {
			break ;
		}
		offset = newOffset ;
		offsets.push(offset) ;
	}
	obj['audio_offsets'] = offsets ;
	
	return obj ;
}


getRecordDesc(programId).then( (programDesc) => {
	let promises = [] ;
	if( programDesc.file_stream ) {
		const path = pathSave+'/'+programDesc.file_stream ;
		const videoPromise = ( async () => {
			const fileHandler = await fsPromises.open(path) ;
			const videoreader = new h264reader(fileHandler,h264reader.getVideoFormatFromPath(path)) ;
			const obj = await buildIndexVideo(videoreader) ;
			await fileHandler.close();
			return obj ;
		})() ;
		promises.push( videoPromise ) ;
	}
	if( programDesc.file_stream && programDesc.file_audio ) {
		const path = pathSave+'/'+programDesc.file_audio ;
		const audioPromise = ( async () => {
			const fileHandler = await fsPromises.open(path) ;
			const audioreader = new adtsReader(fileHandler) ;
			const obj = await buildIndexAudio(audioreader) ;
			await fileHandler.close();
			return obj ;
		})() ;
		promises.push( audioPromise ) ;
	}
	
	function changeExtension(file, extension) {
		const basename = path.basename(file, path.extname(file))
		return path.join(path.dirname(file), basename + '.' + extension)
	}
	const filePathMap = changeExtension(pathSave+'/'+programDesc.file_stream,'map') ;
	Promise.all(promises).then((values) => {
		const obj = {} ;
		for( const iter of values ) {
			Object.assign(obj,iter) ;
		}
		fsPromises.writeFile(filePathMap, JSON.stringify(obj)).then(()=>{}) ;
	});
});
