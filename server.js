import { createServer as createServerHttp  } from 'http';
import { createServer as createServerHttps } from 'https';
import { readFileSync, existsSync, createWriteStream, writeFile } from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { Worker } from "worker_threads" ;

import * as nStatic from "node-static";
import * as url from "url" ;

import axios from 'axios';

import * as uuid from 'uuid';

import { createRequire } from "module";
const _config = createRequire(import.meta.url)("./server-config.json");

const sslpath = _config.ssl_path ;
let server ;
if( existsSync(sslpath) && existsSync(sslpath+'/cert.pem') && existsSync(sslpath+'/privkey.pem') ) {
	server = createServerHttps({
		//cert: readFileSync(sslpath+'/cert.pem'),
		cert: readFileSync(sslpath+'/fullchain.pem'),
		key: readFileSync(sslpath+'/privkey.pem'),
	});
} else {
	server = createServerHttp();
}
server.listen(8080);


var fileServer = new nStatic.Server('./public',{ cache: 0 });

//const wss = new WebSocketServer({ server });
const wss = new WebSocketServer({ noServer: true });




const pathSave = _config.filestore_path ;







const clients = new Map() ;

wss.on('connection', function connection(ws) {
	if( ws.isRecordSource ) {
		registerService(ws) ;
		return ;
	}
	
	const id = uuid.v4() ;
	let type ;
	if( ws.targetServiceWs ) {
		type = 'stream' ;
		console.log('register client '+id+' for '+services.get(ws.targetServiceWs).id) ;
		clients.set(ws,{id,type}) ;
	}
	if( ws.targetReplayStreams ) {
		type = 'file' ;
		console.log('register client '+id+' for replay file='+ws.targetFileId) ;
		clients.set(ws,{id,type}) ;
		
		// setup worker
		const worker = new Worker("./server-fileworker-replay.js", {workerData:{streams:JSON.stringify(ws.targetReplayStreams)}});
		worker.on("message", function(message){
			ws.send(message.data) ;
		});
		worker.on("error", function(){
			console.log('error ???') ;
			ws.terminate() ;
		});
		worker.on("exit", (code) => {
			console.log('finished') ;
			ws.terminate() ;
		});
		ws.targetFileworker = worker ;
	}
	if( !type || !clients.get(ws) ) {
		console.log('!! should not happen !!') ;
		ws.terminate() ;
	}

	
	ws.on('close', function() {
	  clients.delete(ws) ;
	  if( ws.targetFileworker ) {
			ws.targetFileworker.terminate() ;
	  }
	  console.log('websocket closed!') ;
	});
	ws.on('error', function error() {
		console.log('error websocket') ;
		ws.close() ;
	});
});

server.on('request',function request(request,response) {
	const { pathname } = url.parse(request.url);
	console.log( 'Path is : '+pathname ) ;
	
	request.addListener('end', function () {
		if( pathname == '/list/play' ) {
			var list = [] ;
			services.forEach( function(meta,ws) {
				list.push({
					id: meta.id,
					remoteAddress: ws.remoteAddress,
					initTs: ws.init_ts,
				  
					format: ws.videoFormat,
					audio: ws.audioEnabled,
				})
			}) ;
			list.sort( function compare( a, b ) {
				if ( a.initTs > b.initTs ){
					return -1;
				}
				if ( a.initTs < b.initTs ){
					return 1;
				}
				return 0;
			} );
			response.writeHead(200);
			response.write(JSON.stringify(list)) ;
			response.end();
			return ;
		}
		if( pathname == '/list/replay' ) {
			const worker = new Worker("./server-fileworker-list.js", {workerData:{}});
			worker.on("message", function(message){
				response.writeHead(200);
				response.write(JSON.stringify(message)) ;
				response.end();
			});
			return ;
		}
		fileServer.serve(request, response, function (err, res) {
			if( err ) {
				console.dir(err) ;
			}
			if (err && (err.status === 404)) { // If the file wasn't found
					/*
					fileServer.serveFile(
						'/not-found.html', 404, {}, request, response
					);
					*/
					
				response.writeHead(err.status, err.headers);
				response.end();
			}
		});
	}).resume();
}) ;

server.on('upgrade', function upgrade(request, socket, head) {
	const { pathname, query } = url.parse(request.url,true);
	
	switch( pathname ) {
		case '/record' :
			const videoFormat = (query && query.format) ? query.format : 'avc' ;
			const audioEnabled = (query && query.audio && (query.audio >= 1)) ? true : false ;
			switch( videoFormat ) {
				case 'avc' :
				case 'hevc' :
					break ;
				default :
					return socket.destroy() ;
			}
			wss.handleUpgrade(request, socket, head, function done(ws) {
				ws.isRecordSource = true ;
				ws.remoteAddress = socket.remoteAddress ;
				ws.videoFormat = videoFormat ;
				ws.audioEnabled = audioEnabled
				wss.emit('connection', ws, request);
			});
			break ;
		case '/play' :
			let lastServiceId = null ;
			if( services.size > 0 ) {
				lastServiceId = Array.from(services.values())[services.size-1].id ;
				//console.log('last svc is '+lastServiceId) ;
			}
			const requestServiceId = (query && query.id) ? query.id : lastServiceId ;
			if( !requestServiceId ) {
				return socket.destroy() ;
			}
			console.log('requesting '+requestServiceId) ;
			var targetServiceWs = null ;
			services.forEach( function(meta,ws) {
				if( meta.id == requestServiceId ) {
					targetServiceWs = ws ;
				}
			}) ;
			if( !targetServiceWs ) {
				console.log('no such service') ;
				return socket.destroy() ;
			}
			
			//console.dir( query ) ;
			wss.handleUpgrade(request, socket, head, function done(ws) {
				ws.targetServiceWs = targetServiceWs ;
				wss.emit('connection', ws, request);
			});
			break ;
		case '/replay' :
			const fileId = (query && query.id) ? query.id : null ;
			if( !fileId ) {
				return socket.destroy() ;
			}
			console.log('requesting '+fileId) ;
			
			const worker = new Worker("./server-fileworker-list.js", {workerData:{fileId:fileId}});
			worker.on("message", function(message){
				if( message.length != 1 ) {
					socket.destroy() ;
				}
				const streamDesc = message[0] ;
				let replayStreams = [] ;
				if( streamDesc.file_stream ) {
					replayStreams.push({
						id: 0,
						type: 'video',
						filepath: pathSave+'/'+streamDesc.file_stream,
						offsets: streamDesc.offsets,
						videoFps: streamDesc.fps,
					})
					if( streamDesc.file_audio ) {
						replayStreams.push({
							id: 1,
							type: 'audio',
							filepath: pathSave+'/'+streamDesc.file_audio,
							offsets: null,
							audioFps: null,
						})
					}
				}
				//console.dir(replayStreams) ;
				wss.handleUpgrade(request, socket, head, function done(ws) {
					ws.targetFileId = fileId ;
					ws.targetReplayStreams = replayStreams ;
					wss.emit('connection', ws, request);
				});
			});
			break ;
		default :
			socket.destroy() ;
			break ;
	}
});


function cleanupClients() {
	clients.forEach( function(meta,clientWs) {
		if( (meta.type=='stream') && !services.has(clientWs.targetServiceWs) ) {
			clientWs.terminate() ;
		}
		if( (meta.type=='file') && !clientWs.targetFileworker ) {
			// ????
			clientWs.terminate() ;
		}
	});
}






/*
import { WebSocketServer } from 'ws';





const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', function connection(ws) {
  ws.on('message', function message(data) {
    console.log('received: %s', data);
  });

  ws.send('something');
});
*/

const services = new Map() ;

function registerService(ws) {
	const id = uuid.v4();
	console.log('register service '+id) ;
	services.set(ws,{id}) ;
	
	ws.last_ts = ws.init_ts = Date.now() ;
	ws.binaryType = 'arraybuffer' ;
	if( ws.isRecordSource ) {
		const filenameDat = id+'.dat',
			filepathDat = pathSave+'/'+filenameDat ;
		const obj = {
			id: id,
			tsStart: ws.init_ts,
			remoteAddress: ws.remoteAddress
		} ;
		writeFile(filepathDat,JSON.stringify(obj),()=>{}) ;
		
		let fileExtensionVideo ;
		switch( ws.videoFormat ) {
			case 'hevc' :
				fileExtensionVideo = 'hevc' ;
				break ;
			case 'avc' :
			default :
				fileExtensionVideo = 'h264' ;
				break ;
		}
		const fileExtensionAudio = 'aac' ;
		
		ws.writePathVideo = pathSave+'/'+id+'.'+fileExtensionVideo ;
		ws.writeStreamVideo = createWriteStream(ws.writePathVideo) ;
		ws.writePathAudio = pathSave+'/'+id+'.'+fileExtensionAudio ;
		ws.writeStreamAudio = createWriteStream(ws.writePathAudio) ;
	}
	ws.on('message', function message(data) {
		ws.last_ts = Date.now() ;
		
		/*
		const serviceDesc = services.get(ws) ;
		if( !ws.fps_ts ) {
			ws.fps_nb = 1 ;
			ws.fps_ts = ws.last_ts ;
		} else if( ws.last_ts - ws.fps_ts >= 10000 ) {
			const {id} = services.get(ws) ;
			console.log('FPS '+id+' '+(ws.fps_nb / 10)) ;
			ws.fps_ts = null ;
		} else {
			ws.fps_nb++ ;
		}
		*/
		
		if( ws.isECcam ) {
			data = ECcam_onMessageStripHeader(data) ;
		}
		//console.dir(data);
		//console.log( 'received : %s',data) ;
		//console.log('received') ;
		clients.forEach( function(meta,clientWs) {
			if( clientWs.targetServiceWs === ws ) {
				clientWs.send(data) ;
			}
		});
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
		if( (dataType=='video') && ws.writeStreamVideo ) {
			ws.hasVideo = true ;
			ws.writeStreamVideo.write(data) ;
		}
		if( (dataType=='audio') && ws.writeStreamAudio && ws.hasVideo ) {
			ws.audioEnabled = true ;
			ws.writeStreamAudio.write(data) ;
		}
	});
	ws.on('close', function close() {
		if( ws.writeStreamVideo ) {
			ws.writeStreamVideo.end() ;
			ws.writeStreamVideo = null ;
		}
		if( ws.writeStreamAudio ) {
			ws.writeStreamAudio.end() ;
			ws.writeStreamAudio = null ;
		}
		console.log('unregister service '+id) ;
		services.delete(ws) ;
		if( ws.writePathVideo ) {
			const tmpIndexWorker = new Worker("./server-fileworker-buildindex.js", {workerData:{filePath:ws.writePathVideo}});
		}
	});
	ws.on('error', function error() {
		console.log('error websocket') ;
		ws.close() ;
	});
}
function ECcam_onMessageStripHeader(data) {
	//console.dir(data) ;
	//const buf = new Uint8Array(data) ;
	return new Uint8Array(new Uint8Array(data).subarray(36, data.byteLength)) ;
}

const arrCamDesc = [{
	ip: '10.39.10.71',
	isRunning: false,
	runningWs: null
}];

function openPending() {
	for (const desc of arrCamDesc) {
		if( (desc.isRunning || desc.runningWs) && !services.has(desc.runningWs) ) {
			desc.runningWs = null ;
			desc.isRunning = false ;
		}
		if( !desc.isRunning ) {
			ECcam_open(desc) ;
		}
	}
}
function pingExisting() {
	const ts_now = Date.now() ;
	services.forEach( function(meta,ws) {
		//console.log('ping') ;
		//console.dir(meta) ;
		if( ws.last_ts < ts_now - (1000*5) ) {
			ws.terminate() ;
		}
	}) ;
}

function ECcam_open(camDesc) {
	camDesc.isRunning = true ;
	axios.post('http://'+camDesc.ip+'/api.html?n=login', {
		api: 'login',
		data : {
			username: 'admin',
			password: '21232f297a57a5a743894a0e4a801fc3'
		}
	},{timeout: 5*1000}).then((res) => {
		if( res.status != 200 ) {
			return ;
		}
		let cookie = res.data.data.Cookie ;
		cookie = cookie.split('=') ;
		cookie = cookie[1] ;
		console.log(camDesc.ip+' ECcam cookie: '+cookie) ;
		//return ;
		
		
		const ws = new WebSocket('ws://'+camDesc.ip+'/');
		ws.on('open', function open() {
			ws.send('{"index":"0","sessionID":"'+cookie+'"}');
		});
		ws.isECcam = true ;
		ws.remoteAddress = camDesc.ip ;
		ws.videoFormat = 'avc' ;
		
		camDesc.runningWs = ws ;
		registerService(ws) ;
	}).catch((err) => {
		camDesc.isRunning = false ;
		//console.error(err);
	})
}

function globalLoop() {
	openPending() ;
	pingExisting() ;
	cleanupClients() ;
}
globalLoop() ;
var globalLoopInterval = setInterval(function(){
	globalLoop() ;
}, 10*1000);
