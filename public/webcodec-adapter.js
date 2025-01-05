import * as adts from './adts-utils.js' ;

class WebcodecAdapter {
	
	constructor(videoInfo, videodataCb=null, audiodataCb=null) {
		videoInfo = videoInfo || {} ;
		
		this.browserIsChrome = !!window.chrome ;
		this.browserIsFirefox = (typeof InstallTrigger !== 'undefined') ;
		
		this.videoFormat = videoInfo.format || 'avc' ;
		this.videoFps = videoInfo.fps || 30 ;
		
		this.MP4_timescale = 90000 ;
		
		let track_id = 0xffffffff ;
		if( true && videodataCb ) {
			this.videoTrack = {
				type: 'video',
				
				ready: false,
				
				codec: null,
				width: null,
				height: null,
				sps: null,
				pps: null,
				vps: null,
				
				timescale: this.MP4_timescale,
				frameDuration: this.MP4_timescale * (1 / (this.videoFps + (this.browserEnableFasterFps ? 1 : 0))),
				frameCount: 0,
				duration: 0,
				id: track_id--,
				
				nextMP4sequence: 0,
				nextRunningTS: 0,
				
				dataCb: videodataCb
			};
		}
		if( videoInfo.audio && audiodataCb ) {
			this.audioTrack = {
				type: 'audio',
				
				ready: false,
				
				codec: null,
				channelCount: null,
				audiosamplerate: null,
				config:[],
				
				timescale: this.MP4_timescale,
				frameDuration: this.MP4_timescale * (1024 / 44100),
				frameCount: 0,
				duration: 0,
				id: track_id--,
				
				nextMP4sequence: 0,
				nextRunningTS: 0,
				
				dataCb: audiodataCb
			};
		}
	}
	setListenerFn(fn) {
		if( typeof fn === 'function' ) {
			this._listenerFn = fn ;
		}
	}
	
	invalidate() {
		if( this.videoTrack ) {
			Object.assign(this.videoTrack,{
				ready: false,
				
				codec: null,
				width: null,
				height: null,
				sps: null,
				pps: null,
				vps: null,
			});
		}
		if( this.audioTrack ) {
			Object.assign(this.audioTrack,{
				ready: false,
				
				codec: null,
				channelCount: null,
				audiosamplerate: null,
				config:[],
			});
		}
	}
	terminate() {
	}
	
	
	pushData( uarray ) {
		switch( uarray[0] ) {
			case 0x02 : // private byte prefix for audio
				uarray = uarray.subarray(1,uarray.length) ;
				return this.pushAdtsData(uarray) ;
			case 0xFF : // ADTS starts with 0xFF
				return this.pushAdtsData(uarray) ;
				
			default:
				return ;
		}
	}
	pushAdtsData( uarray ) {
		if( !this.audioTrack ) {
			return ;
		}
		if( !this.audioTrack.ready ) {
			const audioConfig = adts.getAudioConfig( uarray,0 ) ;
			
			this.audioTrack.audiosamplerate = audioConfig.samplerate ;
			this.audioTrack.config = audioConfig.config ;
			this.audioTrack.codec = audioConfig.codec ;
			this.audioTrack.channelCount = audioConfig.channelCount ;
			this.audioTrack.ready = true ;
			
			this.audioDecoder = new AudioDecoder({
				output: this.audioTrack.dataCb,
				error: e => console.error(e)
			}) ;
			this.audioDecoder.configure({
				codec: audioConfig.codec,
				description: new Uint8Array(audioConfig.config),
				numberOfChannels: audioConfig.channelCount,
				sampleRate:audioConfig.samplerate,
			});
		}
		if( this.audioTrack.ready ) {
			const headerLength = adts.getHeaderLength(uarray,0);
			const frameLength = adts.getFullFrameLength(uarray,0);
			this.audioTrack.nextRunningTS += this.audioTrack.frameDuration ;
			this.audioTrack.frameCount++ ;
			if( this.audioDecoder ) {
				var chunk = new EncodedAudioChunk({
					type: 'key',
					timestamp: ((this.audioTrack.frameCount - 1 ) * 1000000 * 1024 / 44100),
					duration: (1000000 * 1024 / 44100 ),
					data: uarray.subarray(headerLength,frameLength),
				});
				this.audioDecoder.decode(chunk);
				return ;
			}
		}
		
	}
	
	
}
export default WebcodecAdapter ;
