
import * as path from 'path';

import ExpGolomb from './server-lib-h264-ExpGolomb.js' ;


class h264reader {

	static getVideoFormatFromPath( filePath ) {
		const dotExtension = path.extname(filePath) ;
		let videoFormat = null ;
		if( dotExtension[0] == '.' ) {
			videoFormat = dotExtension.toLowerCase().substr(1) ;
		}
		switch( videoFormat ) {
			case 'hevc' :
				return 'hevc'
			case 'h264' :
			case 'avc'  :
				return 'avc' ;
			
			default : return null ;
		}
	}

	
	
	
	
	constructor(fileHandler,videoFormat) {
		this.fileHandler = fileHandler ;
		this.videoFormat = videoFormat ;
	}
	
	async buildFromOffset( offset ) {
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
			const nalBuffer = await this.getNaluAtOffset(nalOffset) ;
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

	async getNaluAtOffset( offset ) {
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
			let { bytesRead } = await this.fileHandler.read(buffer,0,rsize,offset+(rsize*i)) ;
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
		await this.fileHandler.read(returnBuffer,0,bytesToRead,offset) ;
		
		//await fileHandler.close() ;
		
		//console.log('returning') ;
		return returnBuffer || null ;
	}




	async getSPSdimensions() {
		function discardSP(data) {
			if( data[0]==0 && data[1]==0 ) {
				if( data[2]==1 ) {
					return data.subarray(3) ;
				}
				if( data[2]==0 && data[3]==1 ) {
					return data.subarray(4) ;
				}
			}
			return data ;
		}

		let nalOffset = 0 ;
		let data ;
		while( true ) {
			data = await this.getNaluAtOffset(nalOffset) ;
			nalOffset += data.length ;
			
			const innerData = discardSP(data) ;
			if( (innerData[0] & 0x1f) == 7 ) {
				return new ExpGolomb(innerData).readSPS() ;
			}
			break ;
		}
	}
}

export default h264reader ;
