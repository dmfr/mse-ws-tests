import { createServer } from 'https';
import { readFileSync } from 'fs';
import { WebSocketServer } from 'ws';

import * as nStatic from "node-static";
import * as url from "url" ;

import WebSocket from 'ws';


import axios from 'axios';


/*
axios.post('http://10.39.10.71/api.html?n=login', {
    api: 'login',
    data : {
		username: 'admin',
		password: '21232f297a57a5a743894a0e4a801fc3'
	 }
}).then((res) => {
			console.dir(res) ;
    }).catch((err) => {
        console.error(err);
    })
*/





const ws = new WebSocket('ws://10.39.10.71/');
ws.on('open', function open() {
  ws.send('{"index":"0","sessionID":"f49fd49e79afffb49e446553869c7bd8"}');
});

ws.on('message', function message(data) {
  console.dir(data);
  //console.log( 'received : %s',data) ;
});



