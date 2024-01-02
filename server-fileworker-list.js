
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { Worker } from "worker_threads" ;

import pLimit from 'p-limit' ;

import h264reader from './server-lib-h264reader.js' ;

import { createRequire } from "module";
const _config = createRequire(import.meta.url)("./server-config.json");

let requestedFileId = null 
if( workerData && workerData.fileId ) {
	requestedFileId = workerData.fileId ;
}

// https://stackoverflow.com/questions/37576685/using-async-await-with-a-foreach-loop

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getUUid(str) {
	const matches = str.match(/\w{8}-\w{4}-\w{4}-\w{4}-\w{12}/) ;
	if( !matches ) {
		return null ;
	}
	return matches[0];
}

async function buildFilesList( filestore_path ) {
	let filesList = {} ;
	const files = await fsPromises.readdir(filestore_path) ;
	
	await Promise.all(files.map(async (file) => {
		await timeout(100) ;
		const fileUUID = getUUid(file) ;
		if( !fileUUID ) {
			return ;
		}
		if( requestedFileId && (requestedFileId!=fileUUID) ) {
			return ;
		}
		if( !filesList.hasOwnProperty(fileUUID) ) {
			filesList[fileUUID] = {id: fileUUID, size: 0} ;
		}
		if( path.extname(file) == '.dat' ) {
			const binaryDat = await fsPromises.readFile(filestore_path + '/' + file),
				jsonDat = JSON.parse(binaryDat);
			filesList[fileUUID]['remoteAddress'] = jsonDat.remoteAddress ;
		}
		if( path.extname(file) == '.map' ) {
			filesList[fileUUID]['file_map'] = file ;
			const binaryMap = await fsPromises.readFile(filestore_path + '/' + file),
				jsonMap = JSON.parse(binaryMap) ;
			filesList[fileUUID]['videosize'] = jsonMap.size ;
			filesList[fileUUID]['fps'] = jsonMap.fps || 30 ;
			if( requestedFileId ) {
				filesList[fileUUID]['offsets'] = jsonMap.offsets || null ;
			}
		}
		if( ['.h264','.avc','.hevc'].includes(path.extname(file)) ) {
			filesList[fileUUID]['file_stream'] = file ;
			const infos = await fsPromises.stat(filestore_path + '/' + file) ;
			if( !filesList[fileUUID].hasOwnProperty('date') ) {
				filesList[fileUUID]['date'] = infos.mtime.toISOString() ;
			}
			filesList[fileUUID]['size']+= infos.size ;
			filesList[fileUUID]['format'] = h264reader.getVideoFormatFromPath(file) ;
		}
		if( ['.aac'].includes(path.extname(file)) ) {
			filesList[fileUUID]['file_audio'] = file ;
			const infos = await fsPromises.stat(filestore_path + '/' + file) ;
			filesList[fileUUID]['size']+= infos.size ;
		}
	}));
	
	filesList = Object.values(filesList) ;
	filesList.sort( function compare( a, b ) {
		if ( a.date > b.date ){
			return -1;
		}
		if ( a.date < b.date ){
			return 1;
		}
		return 0;
	} );
	
	return filesList ;
}

function doBuildIndex(filePath) {
	return new Promise(function (resolve, reject) {
		const worker = new Worker("./server-fileworker-buildindex.js", {workerData:{filePath:filePath}});
		worker.on("exit", (code) => {
			resolve() ;
		});
	});
}


const filesList = await buildFilesList( _config.filestore_path ) ;
if( typeof parentPort !== 'undefined' ) {
	if( parentPort ) {
		parentPort.postMessage(filesList);
		//parentPort.close() ;
	}
}
if( !workerData ) {
	//const limit = pLimit(Number.POSITIVE_INFINITY);
	const limit = pLimit(4);
	Promise.all(filesList.map( (filesListRow) => {
		if( !filesListRow.hasOwnProperty('file_map') ) {
			limit(async () => {
				console.log('building for '+filesListRow.file_stream );
				const pathSave = _config.filestore_path,
					filePath = pathSave + '/' + filesListRow.file_stream ;
				await doBuildIndex(filePath) ;
			});
		}
	}));
}
