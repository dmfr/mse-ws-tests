
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';
import { readFileSync } from 'fs';


let filePath = '/var/lib/mse-websocket-save/e3bacf0c-a0c5-4a26-bed5-dd14a184d2c6.h264' ;
let filePathMap = '/var/lib/mse-websocket-save/e3bacf0c-a0c5-4a26-bed5-dd14a184d2c6.map' ;
let videoFps = 30 ;
if( (workerData != null) && (workerData.filePath&&workerData.filePathMap) ) {
	filePath = workerData.filePath ;
	filePathMap = workerData.filePathMap ;
	videoFps = workerData.videoFps || 30 ;
}


const mapBinary = readFileSync(filePathMap) ;
const mapObj = JSON.parse(mapBinary) ;
const mapOffsets = mapObj['offsets'] ;


let timer ;
let offsetIdx = 0 ;

fsPromises.open(filePath).then((fileHandler) => {
	timer = setInterval(() => {
		getDataAtOffsetIdx( fileHandler, offsetIdx ).then( (data) => {
			offsetIdx++ ;
			if( data == null ) {
				clearInterval(timer) ;
				fileHandler.close() ;
			}
			if( parentPort ) {
				parentPort.postMessage({ data });
			}
		});
	}, 1000/videoFps);
},()=>{
	console.log("FileNotFound: "+filePath) ;
});

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDataAtOffsetIdx( fileHandler, offsetIdx ) {
	if( offsetIdx + 2 >= mapOffsets.length ) {
		//EOF
		return null ;
	}
	const offsetStart = mapOffsets[offsetIdx] ;
	const offsetEnd = mapOffsets[offsetIdx+1] ;
	const bytesToRead = offsetEnd - offsetStart ;
	const data = Buffer.alloc(bytesToRead) ;
	await fileHandler.read(data,0,bytesToRead,offsetStart) ;
	return data ;
}

