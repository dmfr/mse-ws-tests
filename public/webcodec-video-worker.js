let videoDecoder = null ;

function onDecoderOutput(videoFrame) {
	//console.dir(videoFrame) ;
	//videoFrame.close() ;
	postMessage(videoFrame,[videoFrame]);
}
function onDecoderError(e) {
	console.dir(e);
}

self.onmessage = (event) => {
	dataObj = event.data ;
	if( dataObj.hasOwnProperty('configure') ) {
		videoDecoder = new VideoDecoder({
			output: onDecoderOutput,
			error: onDecoderError
		}) ;
		videoDecoder.configure(dataObj.configure);
	}
	if( dataObj.hasOwnProperty('decode') ) {
		var decodeObj = dataObj.decode ;
		decodeObj.transfer = [decodeObj.data.buffer];
		var chunk = new EncodedVideoChunk(decodeObj);
		videoDecoder.decode(chunk);
	}
};
