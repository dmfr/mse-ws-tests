import { Worker } from "worker_threads" ;

const worker = new Worker("./server-fileworker.js", {workerData:{filePath:'/tmp/DJIG0000.h264'}});
worker.on("message", function(message){
	console.dir( message ) ;
});
worker.on("error", function(){
	console.dir(arguments) ;
});
worker.on("exit", (code) => {
	if (code !== 0) {
		console.log('finished') ;
		//reject(new Error(`stopped with exit code ${code}`));
	}
});

console.log('lauched') ;
