
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { Worker } from "worker_threads" ;

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
			filesList[fileUUID] = {id: fileUUID} ;
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
		}
		if( ['.h264','.avc','.hevc'].includes(path.extname(file)) ) {
			filesList[fileUUID]['file_stream'] = file ;
			const infos = await fsPromises.stat(filestore_path + '/' + file) ;
			if( !filesList[fileUUID].hasOwnProperty('date') ) {
				filesList[fileUUID]['date'] = infos.mtime.toISOString() ;
			}
			filesList[fileUUID]['size'] = infos.size ;
			filesList[fileUUID]['format'] = h264reader.getVideoFormatFromPath(file) ;
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
if( !workerData ) {
	Promise.all(filesList.map(async (filesListRow) => {
		await timeout(100) ;
		if( !filesListRow.hasOwnProperty('file_map') ) {
			//console.log('building for '+filesListRow.file_stream );
			const pathSave = _config.filestore_path,
				filePath = pathSave + '/' + filesListRow.file_stream ;
			new Worker("./server-fileworker-buildindex.js", {workerData:{filePath:filePath}});
		}
	}));
}
