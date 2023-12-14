
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

import adtsReader from './server-lib-adtsReader.js' ;


let audioreader ;

fsPromises.open('/var/lib/mse-websocket-save/9285d906-98ef-45f2-a133-c4f25bca8e1c.aac').then( (fileHandler) => {
   
    console.log("opened!") ;
	 console.dir(fileHandler) ;
	 
	 audioreader = new adtsReader(fileHandler) ;
	buildIndex(fileHandler).then((obj)=>{
		console.dir(obj,{'maxArrayLength': null});
	}) ;
	
	
	 
});


async function buildIndex( fileHandler ) {
	let obj = {} ;
	
	
	const offsets = [] ;
	
	let offset = 0 ;
	while(true) {
		const { newOffset, data } = await audioreader.buildFromOffset(offset) ;
		//console.log('.') ;
		if( (data == null) && (offsets.length>0) ) {
			const eofOffset = offset ;
			offsets.push(eofOffset) ;
			break ;
		}
		offsets.push(offset) ;
		offset = newOffset ;
	}
	
	obj['offsets'] = offsets ;
	
	return obj ;
}
