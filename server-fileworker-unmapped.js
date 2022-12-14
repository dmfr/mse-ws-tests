
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';

import * as h264reader from './server-lib-h264reader.js' ;


let filePath = '/tmp/null.h264' ;
if( (typeof workerData !== 'undefined') && workerData.filePath ) {
	filePath = workerData.filePath ;
}


let timer ;
let bufferChunks ;
const bufferChunksSize = 30 * 3 ; // 10sec

fsPromises.open(filePath).then((fileHandler) => {
	bufferChunks = [] ;
	timer = setInterval(() => {
		if( bufferChunks.length > 0 ) {
			const data = bufferChunks.shift() ;
			if( data == null ) {
				clearInterval(timer) ;
				fileHandler.close() ;
			}
			if( parentPort ) {
				parentPort.postMessage({ data });
			}
		}
	}, 1000/30);
	loopBuffer( fileHandler ).then(({})=>{
		// EOF reached
	}) ;
},()=>{
	console.log("FileNotFound: "+filePath) ;
});

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function loopBuffer( fileHandler ) {
	let fileOffset = 0 ;
	while(true) {
		const {newOffset,data} = await h264reader.buildFromOffset(fileHandler,fileOffset) ;
			if(data == null) {
				bufferChunks.push(null);
				break ;
			}
			bufferChunks.push(data);
			fileOffset = newOffset;
		
		if( bufferChunks.length > bufferChunksSize ) {
			await timeout(1000) ;
		}
	}
	return {} ;
}

