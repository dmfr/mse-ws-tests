
import { workerData, parentPort } from "worker_threads";
import * as fsPromises from 'fs/promises';
import { readFileSync } from 'fs';

import { Worker } from "worker_threads" ;


import adtsReader from './server-lib-adtsReader.js' ;
import h264reader from './server-lib-h264reader.js' ;

const AAC_SAMPLES_PER_FRAME = 1024;
const AAC_SAMPLERATE = 44100 ; // TODO ?

const BUFFER_CHUNK_SIZE = (30 * 3);  // 3sec ?

const USE_BUFFER = true ;
const USE_OFFSETCACHE = true ;

const debugPathSave = '/var/lib/mse-websocket-save' ;
const debugFileId = '9285d906-98ef-45f2-a133-c4f25bca8e1c' ;

let streams = null ;

// ***** main() ***********
if( (workerData != null) && (workerData.streams) ) {
	streams = JSON.parse(workerData.streams) ;
	doReplayStreams() ;
} else if( debugFileId ) {
	const worker = new Worker("./server-fileworker-list.js", {workerData:{fileId:debugFileId}});
	worker.on("message", function(message){
		if( message.length != 1 ) {
			socket.destroy() ;
		}
		const streamDesc = message[0] ;
		let debugStreams = [] ;
		if( streamDesc.file_stream ) {
			debugStreams.push({
				id: 0,
				type: 'video',
				filepath: debugPathSave + '/' + streamDesc.file_stream,
				offsets: streamDesc.offsets,
				videoFps: streamDesc.fps,
			})
			if( streamDesc.file_audio ) {
				debugStreams.push({
					id: 1,
					type: 'audio',
					filepath: debugPathSave + '/' + streamDesc.file_audio,
					offsets: null,
					audioFps: null,
				})
			}
		}
		streams = debugStreams ;
		doReplayStreams() ;
	});
}
// ************************



function doReplayStreams() {
	//console.log('doReplayStreams') ;
	//console.dir(streams) ;
	streams.forEach( (stream,id) => {
		fsPromises.open(stream.filepath).then((fileHandle) => {
			stream.fileHandle = fileHandle ;
			let streamFps ;
			switch( stream.type ) {
				case 'video' :
					stream.mediaReader = new h264reader(fileHandle,h264reader.getVideoFormatFromPath(stream.filepath)) ;
					streamFps = stream.videoFps || 30 ;
					stream.intervalMs = 1000 * (1/streamFps) ;
					stream.currentFrameIdx = 0 ;
					break ;
				case 'audio' :
					stream.mediaReader = new adtsReader(fileHandle) ;
					streamFps = AAC_SAMPLERATE / AAC_SAMPLES_PER_FRAME ;
					stream.intervalMs = 1000 * (1/streamFps) ;
					stream.currentFrameIdx = 0 ;
					break ;
			}
			if( !USE_OFFSETCACHE || !stream.offsets ) {
				stream.offsets = [0] ;
			}
			if( USE_BUFFER ) {
				runBufferThread(id) ;
			}
			stream.timer = setInterval(() => {
				getNextFrame(id).then( ({data,isEof}) => {
					if( isEof ) {
						//console.log('clear timer #'+id) ;
						clearInterval(stream.timer) ;
						fileHandle.close() ;
						return ;
					}
					if( (data!=null) && parentPort ) {
						parentPort.postMessage({ data });
					}
				}) ;
			}, stream.intervalMs);
		});
	});
}
/*
fsPromises.open(filePath).then((fileHandler) => {
	bufferChunks = [] ;
	timer = setInterval(() => {
		if( bufferChunks.length > 0 ) {
			const data = bufferChunks.shift() ;
			if( data == null ) {
				clearInterval(timer) ;
				fileHandler.close() ;
			}
			if( parentPort ) {
				parentPort.postMessage({ data });
			}
			console.log('.') ;
		}
	}, 1000/videoFps);
	loopBuffer( fileHandler ).then(({})=>{
		// EOF reached
	}) ;
},()=>{
	console.log("FileNotFound: "+filePath) ;
});
fsPromises.open(filePathAudio).then((fileHandlerAudio) => {
	audioreader = new adtsReader(fileHandlerAudio) ;
	
	bufferChunksAudio = [] ;
	timer = setInterval(() => {
		if( bufferChunksAudio.length > 0 ) {
			const data = bufferChunksAudio.shift() ;
			if( data == null ) {
				clearInterval(timer) ;
				fileHandlerAudio.close() ;
			}
			if( parentPort ) {
				parentPort.postMessage({ data });
			}
			console.log('*') ;
		}
	}, 1024/44100 * 1000);
	loopBufferAudio( fileHandlerAudio ).then(({})=>{
		// EOF reached
	}) ;
},()=>{
	console.log("FileNotFound: "+filePath) ;
});
*/

function util_timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getNextFrame(streamId) {
	const bufferChunks = streams[streamId].bufferChunks ;
	if( bufferChunks ) {
		// getNextFrameFromBuffer
		if( bufferChunks.length > 0 ) {
			const data = bufferChunks.shift() ;
			return {data:data, isEof:(data==null)} ;
		} else {
			return {data:null, isEof:false} ;
		}
	}
	const {data,isEof} = await fetchNextFrame(streamId) ;
	return {data,isEof} ;
}
async function fetchNextFrame(streamId) {
	
	const streamCtx = streams[streamId] ;
	const thisFrameIdx = streamCtx.currentFrameIdx ;
	const {data,isEof} = await fetchFrameIdx(streamId,thisFrameIdx) ;
	if( data!=null ) {
		streamCtx.currentFrameIdx = thisFrameIdx + 1 ;
	}
	return {data,isEof} ;
}
async function fetchFrameIdx(streamId,frameIdx) {
	const fileHandle = streams[streamId].fileHandle,
		offsets = streams[streamId].offsets ;
	if( frameIdx >= offsets.length ) {
		// NOTE: COLLISION ! ;
		return {data: null, isEof:false} ;
	}
	const offsetStart = offsets[frameIdx],
		offsetEnd = offsets[frameIdx+1] ;
	if( offsetEnd ) {
		// pre-mapped mode
		const bytesToRead = offsetEnd - offsetStart ;
		if( bytesToRead==0 ) {
			// EOF
			return {data: null, isEof:true} ;
		} else if( !offsets[frameIdx+2] ) {
			// next EOF
			offsets[frameIdx+2] = offsets[frameIdx+1] ;
		}
		const data = Buffer.alloc(bytesToRead) ;
		await fileHandle.read(data,0,bytesToRead,offsetStart) ;
		return {data: data, isEof:false} ;
	}
	const mediaReader = streams[streamId].mediaReader,
		{newOffset,data} = await mediaReader.buildFromOffset(offsetStart) ;
	if( data==null ) {
		return {data: null, isEof:true} ;
	}
	offsets[frameIdx+1] = newOffset ;
	return {data:data, isEof:false} ;
}

async function runBufferThread(streamId) {
	streams[streamId].bufferChunks = [] ;
	const bufferChunks = streams[streamId].bufferChunks ;
	while(true) {
		const {data,isEof} = await fetchNextFrame(streamId) ;
		if( isEof ) {
			bufferChunks.push(null);
			break ;
		}
		if( data!=null ) {
			bufferChunks.push(data);
		}
		
		if( bufferChunks.length > BUFFER_CHUNK_SIZE ) {
			await util_timeout(1000) ;
		}
	}
	return {} ;
}
