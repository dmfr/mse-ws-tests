let videoDecoder = null ;
let offscreenCanvas = null, offscreenCanvasContext = null, offscreenCanvasSized ;

function onDecoderOutput(videoFrame) {
	//console.dir(videoFrame) ;
	//videoFrame.close() ;
	if( offscreenCanvas ) {
		if( !offscreenCanvasSized ) {
			offscreenCanvas.width = videoFrame.displayWidth;
			offscreenCanvas.height = videoFrame.displayHeight;
			offscreenCanvasSized = true;
		}
		offscreenCanvasContext.drawImage( videoFrame, 0, 0, videoFrame.displayWidth, videoFrame.displayHeight ) ;
		videoFrame.close();
		return ;
	}
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
		if( dataObj.offscreenCanvas ) {
			offscreenCanvas = dataObj.offscreenCanvas ;
			offscreenCanvasContext = offscreenCanvas.getContext('2d') ;
		}
		videoDecoder.configure(dataObj.configure);
		offscreenCanvasSized = false;
		if( offscreenCanvas && dataObj.hasOwnProperty('size') ) {
			offscreenCanvas.width = dataObj.size.width;
			offscreenCanvas.height = dataObj.size.height;
			offscreenCanvasSized = true;
		}
	}
	if( dataObj.hasOwnProperty('decode') ) {
		var decodeObj = dataObj.decode ;
		decodeObj.transfer = [decodeObj.data.buffer];
		var chunk = new EncodedVideoChunk(decodeObj);
		videoDecoder.decode(chunk);
	}
};
