import ExpGolomb from './exp-golomb.js';
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
				
				forwardNals: [],
				dataCb: videodataCb
			};
			
			this.videoWorker = new Worker('webcodec-video-worker.js');
			this.videoWorker.onmessage = (e) => {
				this.videoTrack.dataCb(e.data);
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
			
			this.audioWorker = new Worker('webcodec-audio-worker.js');
			this.audioWorker.onmessage = (e) => {
				this.audioTrack.dataCb(e.data);
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
		if( this.videoWorker != null ) {
			this.videoWorker.terminate();
		}
		if( this.audioWorker != null ) {
			this.audioWorker.terminate();
		}
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
			
			this.audioWorker.postMessage({ configure: {
				codec: audioConfig.codec,
				description: new Uint8Array(audioConfig.config),
				numberOfChannels: audioConfig.channelCount,
				sampleRate:audioConfig.samplerate,
			}});
		}
		if( this.audioTrack.ready ) {
			const headerLength = adts.getHeaderLength(uarray,0);
			const frameLength = adts.getFullFrameLength(uarray,0);
			this.audioTrack.nextRunningTS += this.audioTrack.frameDuration ;
			this.audioTrack.frameCount++ ;
			
			this.audioWorker.postMessage({ decode: {
				type: 'key',
				timestamp: ((this.audioTrack.frameCount - 1 ) * 1000000 * 1024 / 44100),
				duration: (1000000 * 1024 / 44100 ),
				data: uarray.subarray(headerLength,frameLength),
			}});
		}
		
	}
	
	pushNalsData( uarray ) {
		if( !this.videoTrack ) {
			return ;
		}
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
			//console.log('AVC NAL type='+objNalu.type) ;
			if( !this.isAvcForwardNAL(objNalu) ) {
				continue ;
			}
			
			if( this.isAvcVideoframeNAL(objNalu) ) {
				this.videoTrack.forwardNals.push({
					runningTs: this.videoTrack.nextRunningTS,
					isKey: (objNalu.type==5),
					data: objNalu.data
				});
				
				hasVCL=true ;
			}
			
			// get datas for init
			if( !this.isMP4initialized ) {
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
			if( !this.isMP4initialized && this.videoTrack.pps && this.videoTrack.sps ) {
				this.videoTrack.ready = true ;
				// PPS+SPS now in track
				// => create source + initialize MP4
				// ==> stop discarding VCL NAL(s)
				// ===> so next NAL(s) from same message (IDR...) will be queued
				this.videoDecoder_configureAvc() ; // MOOV
				continue ;
			}
		}
		if( this.isMP4initialized ) {
			this.buildMP4segments() ; // MOOF + MDAT
		}
		if( hasVCL ) {
			// this.runningTs += this.H264_timebaseRun ;
			
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
			this.videoTrack.nextRunningTS += this.videoTrack.frameDuration ;
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
			//console.log('HEVC NAL type='+objNalu.type) ;
			if( !this.isHevcForwardNAL(objNalu) ) {
				continue ;
			}
			
			if( this.isHevcVideoframeNAL(objNalu) ) {
				//console.log( 'adding video ts='+this.videoTrack.nextRunningTS/this.MP4_timescale ) ;
				this.videoTrack.forwardNals.push({
					runningTs: this.videoTrack.nextRunningTS,
					isKey: ((objNalu.type >= 16) && (objNalu.type < 24)),
					data: objNalu.data
				});
				
				hasVCL=true ;
			}
			
			// get datas for init
			if( !this.videoTrack.ready ) {
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
			if( !this.videoTrack.ready && this.videoTrack.pps && this.videoTrack.sps && this.videoTrack.vps ) {
				this.videoTrack.ready = true ;
				// PPS+SPS+VPS now in track
				// => create source + initialize MP4
				// ==> stop discarding VCL NAL(s)
				// ===> so next NAL(s) from same message (IDR...) will be queued
				this.videoDecoder_configureHevc() ;
				continue ;
			}
		}
		if( this.videoTrack.ready ) {
			this.videoDecoder_decode() ;
		}
		if( hasVCL ) {
			// this.runningTs += this.H264_timebaseRun ;
			this.countVCL++ ;
			this.videoTrack.frameCount++ ;
			this.videoTrack.nextRunningTS += this.videoTrack.frameDuration ;
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
		if( this.isHevcVideoframeNAL(objNalu) && !this.videoTrack.ready ) {
			return false ;
		}
		if( !this.isHevcVideoframeNAL(objNalu) && this.videoTrack.ready ) {
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
				if( !this.videoTrack.ready ) {
					return false ;
				}
				return true ;
			case 7 :
			case 8 :
				if( this.videoTrack.ready ) {
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
	
	videoDecoder_configureHevc() {
		var track = this.videoTrack ;
		var hvccVPS = [
			1 << 7 | 32 & 0x3f,
			0,1,
			0,track.vps[0].byteLength
		].concat(Array.prototype.slice.call(track.vps[0])) ;
		//console.dir(hvccVPS) ;
		var hvccSPS = [
			1 << 7 | 33 & 0x3f,
			0,1,
			0,track.sps[0].byteLength
		].concat(Array.prototype.slice.call(track.sps[0])) ;
		//console.dir(hvccSPS) ;
		var hvccPPS = [
			1 << 7 | 34 & 0x3f,
			0,1,
			0,track.pps[0].byteLength
		].concat(Array.prototype.slice.call(track.pps[0])) ;
		//console.dir(hvccPPS) ;
			
		
		var hvcc = new  Uint8Array([
			/* unsigned int(8) configurationVersion = 1; */
			0x01,
			
			/*
			* unsigned int(2) general_profile_space;
			* unsigned int(1) general_tier_flag;
			* unsigned int(5) general_profile_idc;
			*/
			( 0 << 6 | 0 << 5 | track.general_profile_idc ),
			
			/* unsigned int(32) general_profile_compatibility_flags; */
			0xff,0xff,0xff,0xff,
			
			/* unsigned int(48) general_constraint_indicator_flags; */
			0xff,0xff,0xff,0xff,0xff,0xff,
			
			/* unsigned int(8) general_level_idc; */
			track.general_level_idc,
			
			/*
			* bit(4) reserved = '1111'b;
			* unsigned int(12) min_spatial_segmentation_idc;
			*/
			0xf0, 0x00,
			
			/*
			* bit(6) reserved = '111111'b;
			* unsigned int(2) parallelismType;
			*/
			0 | 0xfc,
			
			/*
			* bit(6) reserved = '111111'b;
			* unsigned int(2) chromaFormat;
			*/
			track.chroma_format_idc | 0xfc,
			
			/*
			* bit(5) reserved = '11111'b;
			* unsigned int(3) bitDepthLumaMinus8;
			*/
			0 | 0xf8,
			
			/*
			* bit(5) reserved = '11111'b;
			* unsigned int(3) bitDepthChromaMinus8;
			*/
			0 | 0xf8,
			
			/* bit(16) avgFrameRate; */
			0,0,
			
			/*
			* bit(2) constantFrameRate;
			* bit(3) numTemporalLayers;
			* bit(1) temporalIdNested;
			* unsigned int(2) lengthSizeMinusOne;
			*/
			(0 << 6 | 0 << 3 | 0 << 2 | 3), // lengthSizeMinusOne, hard-coded to 4 bytes
			
			/* unsigned int(8) numOfArrays; */
			3, // VPS + SPS + PPS
		].concat(hvccVPS).concat(hvccSPS).concat(hvccPPS));
		
		this.videoWorker.postMessage({ configure: {
			codec: this.videoTrack.codec,
			description:hvcc,
			//optimizeForLatency: true,
		}});
	}
	
	videoDecoder_decode() {
		const forwardNals = this.videoTrack.forwardNals ;
		if( forwardNals.length == 0 ) {
			return;
		}
		const firstNal = forwardNals[0];
		
		let length = 0 ;
		for( const unit of forwardNals ) {
			length += unit.data.byteLength ;
		}
		const mdat = new Uint8Array(length + (4 * forwardNals.length));
		const view = new DataView(mdat.buffer);
		let offset = 0 ;
		for( const unit of forwardNals ) {
			view.setUint32(offset, unit.data.byteLength);
			offset += 4;
			mdat.set(unit.data, offset);
			offset += unit.data.byteLength;
		}
		this.videoWorker.postMessage({decode:{
			type: firstNal.isKey ? 'key' : 'delta',
			timestamp: 1e6 * firstNal.runningTs / this.videoTrack.timescale,
			duration: 1e6 * this.videoTrack.frameDuration / this.videoTrack.timescale,
			data:mdat,
		}});
		
		this.videoTrack.forwardNals=[] ;
	}
	
}
export default WebcodecAdapter ;
