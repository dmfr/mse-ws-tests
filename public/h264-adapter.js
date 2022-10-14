import ExpGolomb from './exp-golomb.js';
import MP4 from './mp4-generator.js' ;

class H264adapter {
	
	constructor(video) {
		this.browserIsChrome = !!window.chrome ;
		this.browserIsFirefox = (typeof InstallTrigger !== 'undefined') ;
		this.browserEnableFasterFps = !this.browserIsFirefox ;

		this.videoEl = video ;
		
		this.mediaSource = new MediaSource ;
		this.sourceBuffer = null ;
		
		this.onmso = this.onSourceOpen.bind(this) ;
		this.onsbue = this.onSBUpdateEnd.bind(this);
		this.onsbe = this.onSBError.bind(this);
		
		
		//console.log(this.mediaSource.readyState); // closed
		this.videoEl.src = URL.createObjectURL(this.mediaSource);
		this.mediaSource.addEventListener('sourceopen', this.onmso);
		
		this.H264_fps = 30 ; // var ?
		this.H264_timescale = 90000 ;
		this.H264_timebase = Math.floor(this.H264_timescale / (this.H264_fps + (this.browserEnableFasterFps ? 1 : 0))) ;
		this.H264_timebaseRun = this.H264_timebase ;
		
		this.videoTrack = {
			type: 'video',
			container: 'video/mp4',
			
			codec: null,
			width: null,
			height: null, 
			sps: null,
			pps: null,
			
			timescale: this.H264_timescale,
			duration: 0,
			id: 1,
			
			forwardNals: []
		};
		this.runningTs = 0 ;
		this.countVCL = 0 ;
		
		this.isMediaReady = false ;
		this.isSourceCreated = false ;
		this.isMP4initialized = false ;
		this.MP4sequences = 0 ;
		this.MP4segmentsQueue = [] ;
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
			console.log('play delay : '+playDelay) ;
		}
		
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
			/*
			if( isFF ) {
				// Firefox workaround to allow smooth playback, increasing latency
				if( playDelay < 0.5 ) {
					console.log('GROW DELAY ! :'+playDelay) ;
					this.videoEl.currentTime = buffered.end(0) - 0.5 ;
				}
			}
			*/
		}
		
		this.isMP4appending = false ;
		this.tryAppending() ;
	}
	onSBError() {
		console.log('onSBError') ;
	}
	
	
	terminate() {
		this.mediaSource.removeSourceBuffer( this.sourceBuffer ) ;
		this.sourceBuffer = this.mediaSource = null ;
		
		//this.videoEl.pause() ;
		this.videoEl.removeAttribute("src");
		this.videoEl.load();
		//this.videoEl.src = '' ;
	}
	
	
	
	pushH264data( uarray ) {
		const units = this.getH264units(uarray) ;
		
		// NOTE 29/09
		// requirement :
		// one H264 message = one video frame
		let nbVCL = 0 ;
		for( let i=0 ; i<units.length ; i++ ) {
			const objNalu = units[i] ;
			if( !this.isH264forwardNAL(objNalu) ) {
				continue ;
			}
			
			this.videoTrack.forwardNals.push({
				runningTs: this.runningTs,
				isKey: (objNalu.type==5),
				data: objNalu.data
			});
			if( this.isH264videoframeNAL(objNalu) ) {
				nbVCL++ ;
			}
			
			// get datas for init
			if( !this.isSourceCreated ) {
				switch( objNalu.type ) {
					case 7 : // SPS
						const trackInfo = this.extractH264info( objNalu ) ;
						this.videoTrack.sps = [objNalu.data] ;
						this.videoTrack.width = trackInfo.width ;
						this.videoTrack.height = trackInfo.height ;
						this.videoTrack.codec = trackInfo.codec ;
						break ;
					case 8 : // PPS
						this.videoTrack.pps = [objNalu.data] ;
						break ;
				}
			}
			if( !this.isSourceCreated && this.videoTrack.pps && this.videoTrack.sps ) {
				// PPS+SPS now in track
				// => create source + initialize MP4
				// ==> stop discarding VCL NAL(s)
				// ===> so next NAL(s) from same message (IDR...) will be queued
				this.createSourceBuffer() ;
				this.buildMP4segments() ; // MOOV
				continue ;
			}
		}
		if( this.isSourceCreated ) {
			this.buildMP4segments() ; // MOOF + MDAT
		}
		if( nbVCL > 0 ) {
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
		}
	}
	getH264units( uarray ) {
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
            unitType = uarray[i] & 0x1f;
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
	isH264forwardNAL( objNalu ) {
		switch( objNalu.type ) {
			case 1 :
			case 5 :
				if( !this.isSourceCreated ) {
					return false ;
				}
				return true ;
			case 7 :
			case 8 :
				return true ;
			default :
				return false ;
		}
	}
	isH264videoframeNAL( objNalu ) {
		switch( objNalu.type ) {
			case 1 :
			case 5 :
				return true ;
			default :
				return false ;
		}
	}
	extractH264info( objNalu ) {
		if( objNalu.type == 7 ) {
				var track = {} ;
            var expGolombDecoder = new ExpGolomb(objNalu.data);
            var config = expGolombDecoder.readSPS();
            track.width = config.width;
            track.height = config.height;
            track.sps = [objNalu.data];
            track.duration = 0; 
            var codecarray = objNalu.data.subarray(1, 4);
            var codecstring = 'avc1.';
            for (var i = 0; i < 3; i++) {
              var h = codecarray[i].toString(16);
              if (h.length < 2) {
                h = '0' + h;
              }
              codecstring += h;
            }
            track.codec = codecstring;         
				//console.dir(track) ;
				return track ;
		}
	}
	
	createSourceBuffer() {
		const mimeType = 'video/mp4;codecs='+this.videoTrack.codec ;
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
			var mp4segment = MP4.initSegment([this.videoTrack]) ;
			//console.dir(mp4segment) ;
			
			this.MP4segmentsQueue.push( mp4segment ) ;
			this.tryAppending() ;
			
			this.isMP4initialized = true ;
			return ;
		}
		
		if( !this.isMP4initialized ) {
			return ;
		}
		if( this.videoTrack.forwardNals.length == 0 ) {
			return ;
		}
		
		//console.log('forward nal count '+this.videoTrack.forwardNals.length) ;
		
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
			duration:  this.H264_timebaseRun,
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
		
		this.isMP4appending = true ;
		
		var mp4nextSegment = MP4segmentsQueue.shift() ;
		this.sourceBuffer.appendBuffer(mp4nextSegment);
	}
}
export default H264adapter ;
