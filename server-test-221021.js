import { Worker } from "worker_threads" ;

const worker = new Worker("./server-fileworker-list.js", {workerData:{}});
worker.on("message", function(message){
	console.dir( message ) ;
});
worker.on("error", function(){
	console.dir(arguments) ;
});
worker.on("exit", (code) => {
	console.log('finished') ;
	if (code !== 0) {
		
		//reject(new Error(`stopped with exit code ${code}`));
	}
});

console.log('lauched') ;
