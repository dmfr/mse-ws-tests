
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';
import { readFileSync } from 'fs';

import { Worker } from "worker_threads" ;


import adtsReader from './server-lib-adtsReader.js' ;
import h264reader from './server-lib-h264reader.js' ;
import h264streamer from './server-lib-h264streamer.js' ;


let videoStreamer ;

if( workerData ) {
	videoStreamer = new h264streamer(workerData.videoFormat);
}

if( parentPort ) {
	parentPort.on('message',function(message){
		let data = message.data ;
		
		data = new Uint8Array(data) ;
		var dataType = null ;
		switch( data[0] ) {
			case 0x01 : // private byte prefix for video (unused)
				data = data.subarray(1,data.byteLength) ;
				dataType = 'video' ;
				break ;
			case 0x00 : // AVC/HEVC NALs starts with 0x00
				dataType = 'video' ;
				break ;
				
			case 0x02 : // private byte prefix for audio (unused)
				data = data.subarray(1,data.byteLength) ;
				dataType = 'audio' ;
				break ;
			case 0xFF : // ADTS starts with 0xFF
				dataType = 'audio' ;
				break ;
				
			default:
				break ;
		}
		if( dataType=='video' ) {
			data = videoStreamer.streamData(data) ;
		}
		
		parentPort.postMessage({dataType:dataType, data:data});
	});
}


