import { createServer as createServerHttp  } from 'http';
import { createServer as createServerHttps } from 'https';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { Worker } from "worker_threads" ;

import * as nStatic from "node-static";
import * as url from "url" ;

import axios from 'axios';

import * as uuid from 'uuid';

const path = '/etc/letsencrypt/live/int.mirabel-sil.com/' ;
let server ;
if( existsSync(path) && existsSync(path+'/cert.pem') && existsSync(path+'/privkey.pem') ) {
	server = createServerHttps({
		cert: readFileSync(path+'/cert.pem'),
		key: readFileSync(path+'/privkey.pem')
	});
} else {
	server = createServerHttp();
}
server.listen(8080);


var fileServer = new nStatic.Server('./public',{ cache: 0 });

//const wss = new WebSocketServer({ server });
const wss = new WebSocketServer({ noServer: true });





const arrFilesDesc = [{
	id: 'CLIP1',
	filePath: '/tmp/DJIG0000-30fps-filter.h264'
	//filePath: '/tmp/DJIG0000.h264'
},{
	id: 'CLIP2',
	filePath: '/tmp/TEST3.h264'
}];







const clients = new Map() ;

wss.on('connection', function connection(ws) {
	
	const id = uuid.v4() ;
	let type ;
	if( ws.targetServiceWs ) {
		type = 'stream' ;
		console.log('register client '+id+' for '+services.get(ws.targetServiceWs).id) ;
		clients.set(ws,{id,type}) ;
	}
	if( ws.targetFile ) {
		type = 'file' ;
		console.log('register client '+id+' for '+ws.targetFile) ;
		clients.set(ws,{id,type}) ;
		
		const filePath = arrFilesDesc.find(element => element.id==ws.targetFile).filePath ;
		
		// setup worker
		const worker = new Worker("./server-fileworker.js", {workerData:{filePath:filePath}});
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
			wss.handleUpgrade(request, socket, head, function done(ws) {
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
			if( !arrFilesDesc.find(element => element.id==fileId) ) {
				console.log('no such file') ;
				return socket.destroy() ;
			}
			
			//console.dir( query ) ;
			wss.handleUpgrade(request, socket, head, function done(ws) {
				ws.targetFile = fileId ;
				wss.emit('connection', ws, request);
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
	
	const isECcam = true  ;
	
	ws.last_ts = Date.now() ;
	ws.binaryType = 'arraybuffer' ;
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
		
		if( isECcam ) {
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
	});
	ws.on('close', function close() {
		console.log('unregister service '+id) ;
		services.delete(ws) ;
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
		console.log(cookie) ;
		//return ;
		
		
		const ws = new WebSocket('ws://'+camDesc.ip+'/');
		ws.on('open', function open() {
			ws.send('{"index":"0","sessionID":"'+cookie+'"}');
		});
		
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
