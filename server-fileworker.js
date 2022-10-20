
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';


let fileHandler ;
let fileOffset = 0 ;
let timer ;
let processing = 0 ;

const readAheadSize = 10 * 1000000 ; // 10MB ?

let filePath = '/tmp/null.h264' ;
if( workerData && workerData.filePath ) {
	filePath = workerData.filePath ;
	
}

fsPromises.open(filePath).then((fh) => {
	fileHandler = fh ;
	let readAheadBuffer = null ;
	let readAheadOffset = -1 ;
	if( readAheadSize > 0 ) {
		readAheadBuffer = Buffer.alloc(readAheadSize) ;
	}
	timer = setInterval(() => {
		if( processing > 0 ) {
			console.log('OVERLAPPP!!! '+'('+processing+')') ;
		}
		processing++ ;
		//console.log('interval wakes up...') ;
		buildFromOffset(fileHandler,fileOffset).then(({newOffset,data}) => {
			//console.dir( data ) ;
			fileOffset = newOffset ;
			processing-- ;
			if( data == null ) {
				clearInterval(timer) ;
				fileHandler.close() ;
			}
			if( parentPort ) {
				parentPort.postMessage({ data });
			}
			if( readAheadBuffer != null ) {
				const newReadAheadOffset = Math.floor((fileOffset + readAheadSize*0.5)/readAheadSize) * readAheadSize ;
				if( newReadAheadOffset != readAheadOffset ) {
					readAheadOffset = newReadAheadOffset ;
					console.log('offset is '+fileOffset+ '    readahead:'+readAheadOffset) ;
					fileHandler.read(readAheadBuffer,0,readAheadSize,readAheadOffset).then(({bytesRead,b})=>{}) ;
				}
			}
		})
	}, 1000/30);
},()=>{
	console.log("FileNotFound: "+filePath) ;
});

async function buildFromOffset( fileHandler, offset ) {
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
	
	
	let nalOffset = offset ;
	let newNalOffset ;
	let hasVCLfirstSlice = false ;
	const bufferChunks = [] ;
	while(true) {
		const nalBuffer = await getNaluAtOffset(fileHandler,nalOffset) ;
		if( nalBuffer == null ) {
			console.log( 'end of stream.' ) ;
			break ;
		}
		
		// 
		
		const thisVCLfirstSlice = isVCLfirstSlice(nalBuffer) ;
		if( hasVCLfirstSlice && thisVCLfirstSlice ) {
			break ;
		}
		
		// accept seek & store data
		 //console.log( 'store NAL, offset:'+nalOffset+' size:'+nalBuffer.length ) ;
		nalOffset += nalBuffer.length ;
		bufferChunks.push(nalBuffer) ;
		if( thisVCLfirstSlice ) {
			hasVCLfirstSlice = true ;
		}
	}
	
	
	if( bufferChunks.length == 0 ) {
		const data = null ;
		const newOffset = -1 ;
		return { newOffset, data } ;
	}
	const data = Buffer.concat(bufferChunks) ;
	const newOffset = nalOffset ;
	return { newOffset, data } ;
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
