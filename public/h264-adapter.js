import ExpGolomb from './exp-golomb.js';
import MP4 from './mp4-generator.js' ;
import * as adts from './adts-utils.js' ;

class H264adapter {
	
	constructor(videoEl, videoInfo) {
		videoInfo = videoInfo || {} ;
		
		this.browserIsChrome = !!window.chrome ;
		this.browserIsFirefox = (typeof InstallTrigger !== 'undefined') ;
		this.browserEnableFasterFps = !this.browserIsFirefox ;

		this.videoEl = videoEl ;
		
		this.mediaSource = new MediaSource ;
		this.sourceBuffer = null ;
		
		this.onmso = this.onSourceOpen.bind(this) ;
		this.onsbue = this.onSBUpdateEnd.bind(this);
		this.onsbe = this.onSBError.bind(this);
		
		
		//console.log(this.mediaSource.readyState); // closed
		this.videoEl.src = URL.createObjectURL(this.mediaSource);
		this.mediaSource.addEventListener('sourceopen', this.onmso);
		
		this.videoFormat = videoInfo.format || 'avc' ;
		this.videoFps = videoInfo.fps || 30 ;
		
		this.H264_fps = this.videoFps ; // var ?
		this.H264_timescale = 90000 ;
		this.H264_timebase = Math.floor(this.H264_timescale / (this.H264_fps + (this.browserEnableFasterFps ? 1 : 0))) ;
		this.H264_timebaseRun = this.H264_timebase ;
		
		//this.H264_timescale = this.videoFps + 1 ;
		//this.H264_timebaseRun = 1 ;
		
		this.MP4_timescale = 90000 ;
		
		if( false ) {
			this.videoTrack = {
				type: 'video',
				
				ready: false,
				
				codec: null,
				width: null,
				height: null, 
				sps: null,
				pps: null,
				
				timescale: this.MP4_timescale,
				frameDuration: this.MP4_timescale * (1 / this.H264_fps),
				frameCount: 0,
				duration: 0,
				id: 1,
				
				forwardNals: []
			};
		}
		if( videoInfo.audio ) {
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
				id: 2,
				
				forwardNals: []
			};
		}
		this.runningTs = 0 ;
		this.countVCL = 0 ;
		
		this.isMediaReady = false ;
		this.isSourceCreated = false ;
		this.isMP4initialized = false ;
		this.MP4sequences = 0 ;
		this.MP4segmentsQueue = [] ;
	}
	setListenerFn(fn) {
		if( typeof fn === 'function' ) {
			this._listenerFn = fn ;
		}
	}
	onSourceOpen() {
		//console.log('onSourceOpen') ;
		this.mediaSource.removeEventListener('sourceopen', this.onmso);
	}
	onSBUpdateEnd() {
		//console.log('onSBUpdateEnd') ;
		if( !this.sourceBuffer ) {
			return ;
		}
		
		var buffered = this.sourceBuffer.buffered;
		
		let playPosition = this.videoEl.currentTime ;
		let playDelay = -1 ;
		if( buffered && buffered.length > 0 ) {
			playDelay = this.sourceBuffer.buffered.end(0) - this.videoEl.currentTime ;
		}
		if( this.countVCL % this.H264_fps == 0 ) {
			if( this._listenerFn ) {
				this._listenerFn( {playDelay: playDelay} ) ;
			}
			//console.log('play delay : '+playDelay) ;
		}
		
		/*
		if( playDelay > 0 ) {
			const isChrome = this.browserIsChrome ;
			const isFF = this.browserIsFirefox ;
			
			if( !isFF ) {
// 				// https://bugzilla.mozilla.org/show_bug.cgi?id=1520894
// 				if( playDelay > 0.2 ) {
// 					console.log('JITTER RESYNC ! :'+playDelay) ;
// 					this.videoEl.currentTime = buffered.end(0) ;
// 				}
				let newH264_timebaseRun ;
				if( playDelay >= 0.25 ) {
					newH264_timebaseRun = Math.floor(this.H264_timebase / 2) ;
				} else if( playDelay < 0.1 ) {
					newH264_timebaseRun = this.H264_timebase ;
				}
				if( newH264_timebaseRun && (newH264_timebaseRun != this.H264_timebaseRun) ) {
					this.H264_timebaseRun = newH264_timebaseRun ;
					console.log('JITTER newH264_timebaseRun : '+newH264_timebaseRun) ;
				}
			}
			// if( isFF ) {
			// 	// Firefox workaround to allow smooth playback, increasing latency
			// 	if( playDelay < 0.5 ) {
			// 		console.log('GROW DELAY ! :'+playDelay) ;
			// 		this.videoEl.currentTime = buffered.end(0) - 0.5 ;
			// 	}
			// }
		}
		*/
		
		
		this.isMP4appending = false ;
		this.tryAppending() ;
	}
	onSBError() {
		console.log('onSBError') ;
	}
	
	
	terminate() {
		if( this.sourceBuffer ) {
			this.mediaSource.removeSourceBuffer( this.sourceBuffer ) ;
			this.sourceBuffer = null ;
		}
		this.mediaSource = null ;
		
		//this.videoEl.pause() ;
		this.videoEl.removeAttribute("src");
		this.videoEl.load();
		//this.videoEl.src = '' ;
	}
	
	
	pushData( uarray ) {
		switch( uarray[0] ) {
			case 0x01 : // private byte prefix for video
				uarray = uarray.subarray(1,uarray.length) ;
				return this.pushNalsData(uarray) ;
			case 0x00 : // AVC/HEVC NALs starts with 0x00
				return this.pushNalsData(uarray) ;
				
			case 0x02 : // private byte prefix for audio
				uarray = uarray.subarray(1,uarray.length) ;
				return this.pushAdtsData(uarray) ;
			case 0xFF : // ADTS starts with 0xFF
				return this.pushAdtsData(uarray) ;
				
			default:
				return ;
		}
	}
	
	pushNalsData( uarray ) {
		return ;
		switch( this.videoFormat ) {
			case 'avc' :
				this.pushAvcData(uarray) ;
				break ;
			case 'hevc' :
				this.pushHevcData(uarray) ;
				break ;
		}
	}
	
	pushAvcData( uarray ) {
		const units = this.getNalUnits(uarray) ;
		
		// NOTE 29/09
		// requirement :
		// one H264 message = one video frame
		let hasVCL = false ;
		for( let i=0 ; i<units.length ; i++ ) {
			const objNalu = units[i] ;
			if( !this.isAvcForwardNAL(objNalu) ) {
				continue ;
			}
			
			if( this.isAvcVideoframeNAL(objNalu) ) {
				this.videoTrack.forwardNals.push({
					runningTs: this.runningTs,
					isKey: (objNalu.type==5),
					data: objNalu.data
				});
				
				hasVCL=true ;
			}
			
			// get datas for init
			if( !this.isSourceCreated ) {
				switch( objNalu.type ) {
					case 7 : // SPS
						var codecarray = objNalu.data.subarray(1, 4);
						var codecstring = 'avc1.';
						for (var j = 0; j < 3; j++) {
							var h = codecarray[j].toString(16);
							if (h.length < 2) {
								h = '0' + h;
							}
							codecstring += h;
						}
						
						const trackInfo = new ExpGolomb(objNalu.data).readSPS() ;
						
						this.videoTrack.sps = [objNalu.data] ;
						this.videoTrack.width = trackInfo.width ;
						this.videoTrack.height = trackInfo.height ;
						this.videoTrack.codec = codecstring ;
						break ;
					case 8 : // PPS
						this.videoTrack.pps = [objNalu.data] ;
						break ;
				}
			}
			if( !this.isSourceCreated && this.videoTrack.pps && this.videoTrack.sps ) {
				this.videoTrack.ready = true ;
				// PPS+SPS now in track
				// => create source + initialize MP4
				// ==> stop discarding VCL NAL(s)
				// ===> so next NAL(s) from same message (IDR...) will be queued
				this.maybeCreateSourceBuffer() ;
				this.buildMP4segments() ; // MOOV
				continue ;
			}
		}
		if( this.isSourceCreated ) {
			this.buildMP4segments() ; // MOOF + MDAT
		}
		if( hasVCL ) {
			this.runningTs += this.H264_timebaseRun ;
			
			/*
			// calc accurate fps
			if( this.countVCL % 100 == 0 ) {
				//console.log('every 100 frames') ;
				const nowTS = Date.now();
				if( this.lastTS ) {
					const newH264_timebaseRun = (nowTS-this.lastTS) * 90000 / 1000 / 100 ;
					this.H264_timebaseRun = newH264_timebaseRun ;
				}
				this.lastTS = nowTS ;
			}
			*/
			this.countVCL++ ;
			this.videoTrack.frameCount++ ;
		}
	}
	
	pushHevcData( uarray ) {
		const units = this.getNalUnits(uarray) ;
		
		// NOTE 29/09
		// requirement :
		// one H264 message = one video frame
		let hasVCL = false ;
		for( let i=0 ; i<units.length ; i++ ) {
			const objNalu = units[i] ;
			if( !this.isHevcForwardNAL(objNalu) ) {
				continue ;
			}
			
			if( this.isHevcVideoframeNAL(objNalu) ) {
				this.videoTrack.forwardNals.push({
					runningTs: this.videoTrack.frameCount * this.videoTrack.frameDuration,
					isKey: ((objNalu.type >= 16) && (objNalu.type < 24)),
					data: objNalu.data
				});
				
				hasVCL=true ;
			}
			
			// get datas for init
			if( !this.isSourceCreated ) {
				switch( objNalu.type ) {
					case 32 : // VPS
						this.videoTrack.vps = [objNalu.data] ;
						break ;
					case 33 : // SPS
						const trackInfo = new ExpGolomb(objNalu.data).readSPS_hevc() ;
						
						const codecArr = ['hvc1',''+trackInfo.general_profile_idc,'','L'+trackInfo.general_level_idc,'90'] ;
						switch( trackInfo.general_profile_idc ) {
							case 1 : codecArr[2] = '6' ; break ;
							case 2 : codecArr[2] = '4' ; break ;
							case 3 : codecArr[2] = 'E' ; break ;
							case 4 : codecArr[2] = '10' ; break ;
						}
						
						this.videoTrack.sps = [objNalu.data] ;
						this.videoTrack.width = trackInfo.width ;
						this.videoTrack.height = trackInfo.height ;
						this.videoTrack.codec = codecArr.join('.') ;
						
						this.videoTrack.general_profile_idc = trackInfo.general_profile_idc ;
						this.videoTrack.general_level_idc = trackInfo.general_level_idc ;
						this.videoTrack.chroma_format_idc = trackInfo.chroma_format_idc ;
						break ;
					case 34 : // PPS
						this.videoTrack.pps = [objNalu.data] ;
						break ;
				}
			}
			if( !this.isSourceCreated && this.videoTrack.pps && this.videoTrack.sps && this.videoTrack.vps ) {
				this.videoTrack.ready = true ;
				// PPS+SPS+VPS now in track
				// => create source + initialize MP4
				// ==> stop discarding VCL NAL(s)
				// ===> so next NAL(s) from same message (IDR...) will be queued
				this.maybeCreateSourceBuffer() ;
				this.buildMP4segments() ; // MOOV
				continue ;
			}
		}
		if( this.isSourceCreated ) {
			this.buildMP4segments() ; // MOOF + MDAT
		}
		if( hasVCL ) {
			this.runningTs += this.H264_timebaseRun ;
			this.countVCL++ ;
			this.videoTrack.frameCount++ ;
		}
	}
	
	pushAdtsData( uarray ) {
		const hasOneFrame = true ;
		if( !this.isSourceCreated ) {
			const audioConfig = adts.getAudioConfig( uarray,0 ) ;
			
			this.audioTrack.audiosamplerate = audioConfig.samplerate ;
			this.audioTrack.config = audioConfig.config ;
			this.audioTrack.codec = audioConfig.codec ;
			this.audioTrack.channelCount = audioConfig.channelCount ;
			this.audioTrack.ready = true ;
			
			this.maybeCreateSourceBuffer() ;
			this.buildMP4segments() ;
		}
		if( this.isSourceCreated ) {
			console.log( 'sound frame') ;
			console.log( uarray.byteLength ) ;
			const headerLength = adts.getHeaderLength(uarray,0);
			console.log( headerLength ) ;
			// retrieve frame size
			const frameLength = adts.getFullFrameLength(uarray,0);
			console.log( frameLength ) ;
			
			this.audioTrack.forwardNals.push({
				runningTs: this.audioTrack.frameCount * this.audioTrack.frameDuration,
				data: uarray.subarray(headerLength,frameLength),
			});
			this.audioTrack.frameCount++ ;
			this.buildMP4segments() ; // MOOF + MDAT
		}
		
	}
	
	getNalUnits( uarray ) {
    var i = 0, len = uarray.byteLength, value, overflow, state = 0; //state = this.avcNaluState;
    var units = [], unit, unitType, lastUnitStart, lastUnitType; 
    while (i < len) {
      value = uarray[i++];
      // finding 3 or 4-byte start codes (00 00 01 OR 00 00 00 01)
      switch (state) {
        case 0:
          if (value === 0) {
            state = 1;
          }
          break;
        case 1:
          if( value === 0) {
            state = 2;
          } else {
            state = 0;
          }
          break;
        case 2:
        case 3:
          if( value === 0) {
            state = 3;
          } else if (value === 1 && i < len) {
				 switch( this.videoFormat ) {
					 case 'hevc' :
						unitType = (uarray[i] & 0x7E) >> 1 ;
						 break ;
					 case 'avc' :
						unitType = uarray[i] & 0x1f;
						break ;
					 default :
						 unitType = null ;
						 break ;
				 }
            if (lastUnitStart) {
              unit = {data: uarray.subarray(lastUnitStart, i - state - 1), type: lastUnitType}; 
              units.push(unit); 
            } else { 
            }
            lastUnitStart = i;
            lastUnitType = unitType;
            state = 0;
          } else {
            state = 0;
          }
          break;
        default:
          break;
      }
    }

    if (lastUnitStart) { 
      unit = {data: uarray.subarray(lastUnitStart, len), type: lastUnitType, state : state};
      units.push(unit); 
    }

    return units;
	}
	
	isHevcForwardNAL( objNalu ) {
		if( this.isHevcVideoframeNAL(objNalu) && !this.isSourceCreated ) {
			return false ;
		}
		if( !this.isHevcVideoframeNAL(objNalu) && this.isSourceCreated ) {
			return false ;
		}
		return true ;
	}
	isHevcVideoframeNAL( objNalu ) {
		const nalType = objNalu.type ;
		if( nalType < 32 ) {
			return true ;
		}
		return false ;
	}
	
	isAvcForwardNAL( objNalu ) {
		switch( objNalu.type ) {
			case 1 :
			case 5 :
				if( !this.isSourceCreated ) {
					return false ;
				}
				return true ;
			case 7 :
			case 8 :
				if( this.isSourceCreated ) {
					return false ;
				}
				return true ;
			default :
				return false ;
		}
	}
	isAvcVideoframeNAL( objNalu ) {
		switch( objNalu.type ) {
			case 1 :
			case 5 :
				return true ;
			default :
				return false ;
		}
	}
	
	maybeCreateSourceBuffer() {
		if( this.videoTrack && !this.videoTrack.ready ) {
			return ;
		}
		if( this.audioTrack && !this.audioTrack.ready ) {
			return ;
		}
		
		var codecs = [] ;
		if( this.videoTrack ) {
			codecs.push(this.videoTrack.codec) ;
		}
		if( this.audioTrack ) {
			codecs.push(this.audioTrack.codec) ;
		}
		const mimeType = 'audio/mp4;codecs='+codecs.join(',') ;
		try {
			this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
			this.sourceBuffer.addEventListener('updateend', this.onsbue);
			this.sourceBuffer.addEventListener('error', this.onsbe);
		} catch(err) {
			console.dir(err) ;
		}
		this.isSourceCreated = true ;
		this.videoEl.play() ;
		
		this.videoEl.addEventListener('pause', function () {
			// Chrome (+FF ?) pauses video when page in background
			// => force play to avoid buffer filling (+ latency) // NOTE : solved anyway by jitter reset
			// => force play anyway for perf benchmarking
			this.play();
		}, true);
	}
	
	buildMP4segments() {
		 if( this.videoEl.error ) {
			console.dir(this.videoEl.error) ;
			console.log(
				'trying to append although a media error occured, flush segment and abort'
			);
			return;
		}
		if( this.isSourceCreated && !this.isMP4initialized ) {
			//MP4.init() ;
			var tracks = [] ;
			if( this.videoTrack ) {
				tracks.push(this.videoTrack) ;
			}
			if( this.audioTrack ) {
				tracks.push(this.audioTrack) ;
			}
			var mp4segment = MP4.initSegment(tracks) ;
			//console.dir(mp4segment) ;
			
			this.MP4segmentsQueue.push( mp4segment ) ;
			this.tryAppending() ;
			
			this.isMP4initialized = true ;
			return ;
		}
		
		if( !this.isMP4initialized ) {
			return ;
		}
		//if( this.videoTrack.forwardNals.length == 0 ) {
			//return ;
		//}
		
		if( this.videoTrack ) {
		console.log('forward video nal count '+this.videoTrack.forwardNals.length) ;
		}
		if( this.videoTrack && this.videoTrack.forwardNals.length > 0 ) {
		var forwardNals = this.videoTrack.forwardNals,
			runningTs = forwardNals[0].runningTs,
			isKey = false,
			length = 0 ;
		for (let i = 0; i < forwardNals.length; i++) {
			length += forwardNals[i].data.byteLength ;
			if( forwardNals[i].isKey ) {
				isKey = true ;
			}
		}
		/* concatenate the video data and construct the mdat in place
			(need 8 more bytes to fill length and mpdat type) */
		let mdat = new Uint8Array(length + (4 * forwardNals.length) + 8);
		let view = new DataView(mdat.buffer);
		let offset = 0, mp4SampleLength = 0 ;
		view.setUint32(0, mdat.byteLength);
		offset += 8 ;
		mdat.set(MP4.types.mdat, 4);
		for (let i = 0; i < forwardNals.length; i++) {
			let unit = forwardNals[i] ;
			view.setUint32(offset, unit.data.byteLength);
			offset += 4;
			mdat.set(unit.data, offset);
			offset += unit.data.byteLength;
			
			mp4SampleLength += 4 + unit.data.byteLength;
		}
		this.videoTrack.forwardNals = [] ;		
		
		var moofObj = {
			size: mp4SampleLength,  
			duration:  this.videoTrack.frameDuration,
			cts: 0,
			flags: {
				isLeading: 0,
				isDependedOn: 0,
				hasRedundancy: 0,
				degradPrio: 0,
				dependsOn : isKey ? 2 : 1,
				isNonSync : isKey ? 0 : 1
			}
		} ;
		let moof = MP4.moof(this.MP4sequences, runningTs  , {id:1, samples:[moofObj]});
		this.MP4sequences++ ;
		
		/*
		this.MP4segmentsQueue.push( moof ) ;
		this.MP4segmentsQueue.push( mdat ) ;
		*/
		const mergedArray = new Uint8Array(moof.length + mdat.length);
		mergedArray.set(moof);
		mergedArray.set(mdat, moof.length);
		this.MP4segmentsQueue.push( mergedArray ) ;
		}
		if( this.audioTrack ) {
		console.log('forward audio nal count '+this.audioTrack.forwardNals.length) ;
		}
		if( this.audioTrack && this.audioTrack.forwardNals.length > 0 ) {
		var forwardNals = this.audioTrack.forwardNals,
			runningTs = forwardNals[0].runningTs,
			isKey = false,
			length = 0 ;
		for (let i = 0; i < forwardNals.length; i++) {
			length += forwardNals[i].data.byteLength ;
			if( forwardNals[i].isKey ) {
				isKey = true ;
			}
		}
		/* concatenate the video data and construct the mdat in place
			(need 8 more bytes to fill length and mpdat type) */
		let mdat = new Uint8Array(length + (4 * forwardNals.length) + 8);
		let view = new DataView(mdat.buffer);
		let offset = 0, mp4SampleLength = 0 ;
		view.setUint32(0, mdat.byteLength);
		offset += 8 ;
		mdat.set(MP4.types.mdat, 4);
		for (let i = 0; i < forwardNals.length; i++) {
			let unit = forwardNals[i] ;
			view.setUint32(offset, unit.data.byteLength);
			offset += 4;
			mdat.set(unit.data, offset);
			offset += unit.data.byteLength;
			
			mp4SampleLength += 4 + unit.data.byteLength;
		}
		this.audioTrack.forwardNals = [] ;		
		
		var moofObj = {
			size: mp4SampleLength,  
			duration:  this.audioTrack.frameDuration,
			cts: 0,
			flags: {
				isLeading: 0,
				isDependedOn: 0,
				hasRedundancy: 0,
				degradPrio: 0,
				dependsOn : 1,
				isNonSync : 0,
			}
		} ;
		console.dir(moofObj) ;
		let moof = MP4.moof(this.MP4sequences, runningTs  , {id:2, samples:[moofObj]});
		this.MP4sequences++ ;
		
		/*
		this.MP4segmentsQueue.push( moof ) ;
		this.MP4segmentsQueue.push( mdat ) ;
		*/
		const mergedArray = new Uint8Array(moof.length + mdat.length);
		mergedArray.set(moof);
		mergedArray.set(mdat, moof.length);
		this.MP4segmentsQueue.push( mergedArray ) ;
		}
		
		
		
		this.tryAppending() ;
	}
	
	tryAppending() {
		if( !this.sourceBuffer || this.isMP4appending ) {
			return ;
		}
		var MP4segmentsQueue = this.MP4segmentsQueue ;
		if( MP4segmentsQueue.length == 0 ) {
			return ;
		}
		
			if( this._listenerFn ) {
				console.log('push') ;
		while( MP4segmentsQueue.length > 0 ) {
			this._listenerFn( {debug: MP4segmentsQueue.shift()} ) ;

			
		}
		return ;
			}
		
		return ;
		
		this.isMP4appending = true ;
		
		var mp4nextSegment = MP4segmentsQueue.shift() ;
		this.sourceBuffer.appendBuffer(mp4nextSegment);
	}
}
export default H264adapter ;
