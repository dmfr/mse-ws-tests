let audioDecoder = null ;

function onDecoderOutput(audioData) {
	postMessage(audioData,[audioData]);
}
function onDecoderError(e) {}

self.onmessage = (event) => {
	dataObj = event.data ;
	if( dataObj.hasOwnProperty('configure') ) {
		audioDecoder = new AudioDecoder({
			output: onDecoderOutput,
			error: onDecoderError
		}) ;
		audioDecoder.configure(dataObj.configure);
	}
	if( dataObj.hasOwnProperty('decode') ) {
		var chunk = new EncodedAudioChunk(dataObj.decode);
		audioDecoder.decode(chunk);
	}
};
