
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';
import * as path from 'path';

import { createRequire } from "module";
const _config = createRequire(import.meta.url)("./server-config.json");

let requestedFileId = null 
if( (typeof workerData !== 'undefined') && workerData.fileId ) {
	requestedFileId = workerData.fileId ;
}

// https://stackoverflow.com/questions/37576685/using-async-await-with-a-foreach-loop

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getUUid(str) {
	const matches = str.match(/\w{8}-\w{4}-\w{4}-\w{4}-\w{12}/) ;
	return matches[0];
}

async function buildFilesList( filestore_path ) {
	let filesList = {} ;
	const files = await fsPromises.readdir(filestore_path) ;
	
	await Promise.all(files.map(async (file) => {
		await timeout(100) ;
		const fileUUID = getUUid(file) ;
		if( requestedFileId && (requestedFileId!=fileUUID) ) {
			return ;
		}
		if( !filesList.hasOwnProperty(fileUUID) ) {
			filesList[fileUUID] = {id: fileUUID} ;
		}
		if( path.extname(file) == '.dat' ) {
			const binaryDat = await fsPromises.readFile(filestore_path + '/' + file),
				jsonDat = JSON.parse(binaryDat);
			filesList[fileUUID]['remoteAddress'] = jsonDat.remoteAddress ;
		}
		if( path.extname(file) == '.map' ) {
			filesList[fileUUID]['file_map'] = file ;
			const binaryMap = await fsPromises.readFile(filestore_path + '/' + file) ;
			filesList[fileUUID]['videosize'] = JSON.parse(binaryMap).size ;
		}
		if( path.extname(file) == '.h264' ) {
			filesList[fileUUID]['file_stream'] = file ;
			const infos = await fsPromises.stat(filestore_path + '/' + file) ;
			if( !filesList[fileUUID].hasOwnProperty('date') ) {
				filesList[fileUUID]['date'] = infos.mtime.toISOString() ;
			}
			filesList[fileUUID]['size'] = infos.size ;
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

const filesList = await buildFilesList( _config.filestore_path ) ;
if( typeof parentPort !== 'undefined' ) {
	if( parentPort ) {
		parentPort.postMessage(filesList);
		//parentPort.close() ;
	}
}
