
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';
import * as path from 'path';

import * as h264reader from './server-lib-h264reader.js' ;


let filePath = '/tmp/null.h264' ;
if( (typeof workerData !== 'undefined') && workerData.filePath ) {
	filePath = workerData.filePath ;
}
function changeExtension(file, extension) {
  const basename = path.basename(file, path.extname(file))
  return path.join(path.dirname(file), basename + '.' + extension)
}
const filePathMap = changeExtension(filePath,'map') ;


fsPromises.open(filePath).then((fileHandler) => {
	buildIndex(fileHandler).then((obj)=>{
		//write obj to MAP
		fsPromises.writeFile(filePathMap, JSON.stringify(obj)).then(()=>{}) ;
	}) ;
},()=>{
	console.log("FileNotFound: "+filePath) ;
});


async function buildIndex( fileHandler ) {
	let obj = {} ;
	
	try {
		const {width,height} = await h264reader.getSPSdimensions(fileHandler) ;
		obj['size'] = {width,height} ;
	} catch(e) {}
	
	
	const offsets = [] ;
	
	const { newOffset, data } = await h264reader.buildFromOffset(fileHandler,0) ;
	offsets.push(newOffset-data.length) ;
	let offset = 0 ;
	while(true) {
		const { newOffset, data } = await h264reader.buildFromOffset(fileHandler,offset) ;
		if( data == null ) {
			break ;
		}
		offset = newOffset ;
		offsets.push(offset) ;
	}
	
	obj['offsets'] = offsets ;
	
	return obj ;
}
