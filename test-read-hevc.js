
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

import * as hevcTools from './server-hevc-tools.js' ;
import ExpGolomb from './server-lib-h264-ExpGolomb.js' ;





async function getNaluAtOffset( fileHandler, offset ) {
	//console.dir('entering') ;
	
	//await timeout(1000) ;
	// lecture par incréments
	//const fileDesc = filesLibrary.get(title) ;
	//const fileHandler = await fsPromises.open(fileDesc.path) ;
	
	
	const rsize = 32768 ;
	const buffer = Buffer.alloc(rsize) ;
	let i = 0, bytesReadTotal = 0 ;
	let thisNalEnd ;
	while( true ) {
		//console.log('reading?') ;
		let { bytesRead } = await fileHandler.read(buffer,0,rsize,offset+(rsize*i)) ;
		//console.log( i + ' ' + bytesRead ) ;
		bytesReadTotal += bytesRead ; 
		if( bytesRead==0 ) {
			break ;
		}
		
		//console.dir(buffer) ;
		
		thisNalEnd = buffer.indexOf(new Uint8Array([0, 0, 1]),( i>0 ? 0 : 3 )) ;
		if( (thisNalEnd>0) && (buffer[thisNalEnd-1]==0) ) {
			thisNalEnd-- ;
		}
		if( thisNalEnd >= 0 ) {
			thisNalEnd += rsize*i ;
			//console.log( 'Nal size : '+thisNalEnd ) ;
			break ;
		}
		i++ ;
	}
	
	if( bytesReadTotal==0 ) {
		console.log('null') ;
		return null ;
	}
	
	let bytesToRead ;
	if( (thisNalEnd >= 0) ) {
		bytesToRead = thisNalEnd ;
	} else {
		bytesToRead = bytesReadTotal ;
	}
	const returnBuffer = Buffer.alloc(bytesToRead) ;
	await fileHandler.read(returnBuffer,0,bytesToRead,offset) ;
	
	//await fileHandler.close() ;
	
	//console.log('returning') ;
	return returnBuffer || null ;
}




async function readHandler( fileHandler ) {
	let nalOffset = 0 ;
	while(true) {
		const nalBuffer = await getNaluAtOffset(fileHandler,nalOffset) ;
		//console.dir(nalBuffer) ;
		if( nalBuffer == null ) {
			console.log( 'end of stream.' ) ;
			break ;
		}
		nalOffset += nalBuffer.length ;
		
		//console.log( 'found NAL, offset:'+nalOffset+' size:'+nalBuffer.length) ;
		//continue ;
		
		let str = '' ;
		if( !hevcTools.hevcIsVCL(nalBuffer) ) {
			str = '' ;
		} else {
			let substr = hevcTools.hevcIsIRAP(nalBuffer) ? 'IRAP' : 'VCL' ;
			if( !hevcTools.hevcIsVCLfirst(nalBuffer) ) {
				str = substr ;
			} else {
				str = 'First '+substr ;
			}
		}
		console.log( 'found NAL, offset:'+nalOffset+' size:'+nalBuffer.length+' type:'+hevcTools.hevcGetNalType(nalBuffer)+'   '+str ) ;
		if( hevcTools.hevcIsSPS(nalBuffer) ) {
			var gfxDimensions = (new ExpGolomb(hevcTools.hevcDiscardNalSeparator(nalBuffer))).readSPS_hevc() ;
			console.dir(gfxDimensions) ;
		}
	}	
}




	
fsPromises.open('/tmp/test.hevc').then( (fileHandler) => {
   
    console.log("opened!") ;
	 console.dir(fileHandler) ;
	 
	const rsize = 1048576 ;
	const buffer = Buffer.alloc(rsize) ;
	let i = 0, bytesReadTotal = 0 ;
	let offset = 0 ;
	 readHandler(fileHandler).then(() => {
		 console.log('done') ;
	 });
   
	 
});
