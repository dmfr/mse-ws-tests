import { createServer } from 'https';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { WebSocketServer } from 'ws';

import * as nStatic from "node-static";
import * as url from "url" ;

import WebSocket from 'ws';


import axios from 'axios';

import H264parser from './local-test-h264parser.js';



const filesLibrary = new Map() ;
filesLibrary.set('DJIG0000',{path: '/tmp/DJIG0000.h264'}) ;


async function getDescriptor( title ) {
	function isVCLfirstSlice(data) {
		// remove SP
		if( data[0]==0 && data[1]==0 ) {
			if( data[2]==1 ) {
				data = data.subarray(3) ;
			}
			if( data[2]==0 && data[3]==1 ) {
				data = data.subarray(4) ;
			}
		}
		
		
		// NAL type 1(NDR) or 5(IDR)
		const nalType = data[0] & 0x1f ;
		if( (nalType==1 || nalType==5) ) {
			
			// first value for VLC is first_mb_in_slice
			// ..has to be 0 for first slice
			// check if first bit is 1 ==> decoded value is 0
			if( data[1] >> 7 == 1 ) {
				return true ;
			}
		}
		return false ;
	}
	
	
	if( !filesLibrary.has(title) ) {
		return null ;
	}
	const fileDesc = filesLibrary.get(title) ;
	if( fileDesc.hasBeenRead ) {
		return fileDesc ;
	}
	
	// file exists ?
	const statResult = fsPromises.stat(fileDesc.path) ;
	const fileHandler = await fsPromises.open(fileDesc.path) ;
	
	const h264parser = new H264parser() ;
	
	let nalOffset = 0 ;
	while(true) {
		const nalBuffer = await getNaluAtOffset(fileHandler,nalOffset) ;
		if( nalBuffer == null ) {
			console.log( 'end of stream.' ) ;
			break ;
		}
		nalOffset += nalBuffer.length ;
		// console.log( 'found NAL, offset:'+nalOffset+' size:'+nalBuffer.length ) ;
		
		
		var nalDescObj = h264parser.parseNal( H264parser.discardSP(nalBuffer) ) ;
		if( (nalDescObj.first_mb_in_slice===0) != isVCLfirstSlice(nalBuffer) ) {
			console.log('error!!') ;
		}
		
		//console.dir(nalBuffer) ;
		//
		//console.dir(nalDescObj) ;
		
		//console.log(' ') ;
		
		//await timeout(1000);
	}
	
	/*
	const rsize = 1048576 ;
	const buffer = Buffer.alloc(rsize) ;
	let i = 0 ;
	let nalStart = 0 ;
	let nalEnd ;
	await fileHandler.read(buffer,0,rsize,rsize*i) ;
	console.log( 'found NAL, type:'+getNalType( buffer[nalStart+2]==1 ? buffer[nalStart+3] : buffer[nalStart+4] )+ ', nalStart:'+nalStart ) ;
	//return ;
	while( true ) {
		let { bytesRead } = await fileHandler.read(buffer,0,rsize,rsize*i) ;
		//console.log( i + ' ' + bytesRead ) ;
		if( bytesRead==0 ) {
			break ;
		}
		
		//console.dir(buffer) ;
		while( true ) {
			const posStartInBuffer = buffer.indexOf(new Uint8Array([0, 0, 1]),(nalStart -(rsize*i)) +3) ;
			let newNalStart = posStartInBuffer ;
			if( (newNalStart>0) && (buffer[newNalStart-1]==0) ) {
				newNalStart-- ;
			}
			if( newNalStart >= 0 ) {
				const thisNalEnd = (rsize*i) + newNalStart ;
				nalStart = thisNalEnd ;
				console.log( 'found NAL, type:'+getNalType( buffer[posStartInBuffer+2]==1 ? buffer[posStartInBuffer+3] : buffer[posStartInBuffer+4] )+ ', nalStart:'+nalStart ) ;
				continue ;
			}
			break ;
		}
		i++ ;
	}
	*/
	await fileHandler.close() ;
	
	return statResult ;
}
async function getNaluAtOffset( fileHandler, offset ) {
	//console.dir('entering') ;
	
	//await timeout(1000) ;
	// lecture par incréments
	//const fileDesc = filesLibrary.get(title) ;
	//const fileHandler = await fsPromises.open(fileDesc.path) ;
	
	
	const rsize = 1048576 ;
	const buffer = Buffer.alloc(rsize) ;
	let i = 0, bytesReadTotal = 0 ;
	let thisNalEnd ;
	while( true ) {
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






// NOTE : https://blog.appsignal.com/2022/07/20/an-introduction-to-multithreading-in-nodejs.html











function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function dummyWait() {
	return new Promise((resolve) => {
    setTimeout(() => resolve(value), 100);
  });
}







getDescriptor('DJIG0000').then(function(response) {
	console.dir(response) ;
});




/*
fs.open('/tmp/DJIG0000.h264', 'r', function(status, fd) {
    if (status) {
        console.log(status.message);
        return;
    }
    
    
    return ;
	 
	 
	const readLength = 1000 ;
	let readOffset = 0 ;
	
	var buffer = Buffer.alloc(readLength);
	 
	(function loop() {
		if (readOffset <= last_page) {
			fs.read(fd, buffer, 0, 100, 0, function(err, num) {
					if (!error && response.statusCode == 200) {
						store_data(body)
					}
					page++;
					loop();
			});
		}
	}());	 
	 
});
*/
