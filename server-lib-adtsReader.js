
import * as path from 'path';

class adtsReader {
	
	static searchForHeader(data,offset=0) {
		//let offset = 0 ;
		while( offset+1 < data.length ) {
			if( this.isHeaderPattern(data,offset) ) {
				return offset ;
			}
			offset++ ;
		}
		return -1 ;
	}
	static isHeaderPattern(data, offset) {
		return data[offset] === 0xff && (data[offset + 1] & 0xf6) === 0xf0;
	}
	static getHeaderLength(data, offset) {
		return (data[offset + 1] & 0x01 ? 7 : 9);
	}
	static getFullFrameLength(data, offset) {
		return ((data[offset + 3] & 0x03) << 11) |
		(data[offset + 4] << 3) |
		((data[offset + 5] & 0xE0) >>> 5);
	}

	constructor(fileHandler) {
		this.fileHandler = fileHandler ;
	}
	
	async buildFromOffset( offset ) {
		const rsize = 32768 ;
		const buffer = Buffer.alloc(rsize) ;
		let i = 0, bytesReadTotal = 0 ;
		let thisNalEnd ;
		while( true ) {
			let { bytesRead } = await this.fileHandler.read(buffer,0,rsize,offset+(rsize*i)) ;
			if( bytesRead==0 ) {
				return { newOffset: -1 , data:null } ;
			}
			if( !this.constructor.isHeaderPattern(buffer,0) ) {
				return { newOffset: -1 , data:null } ;
			}
			let data ;
			const frameLength = this.constructor.getFullFrameLength(buffer,0) ;
			if( frameLength <= rsize ) {
				data = buffer.subarray(0,frameLength) ;
			} else {
				data = Buffer.alloc(frameLength) ;
				await this.fileHandler.read(data,0,frameLength,offset) ;
			}
			const newOffset = offset+frameLength ;
			return { newOffset , data } ;
		}
	}
	
}

export default adtsReader ;
