
import * as path from 'path';

import * as hevcTools from './server-hevc-tools.js' ;
import h264reader from './server-lib-h264reader.js' ;


class h264streamer {
	constructor(videoFormat) {
		this.videoFormat = videoFormat ;
		this.map_nalType_data = {} ;
	}
	
	async initFromFile(fileHandle) {
		const mediaReader = new h264reader(fileHandle,this.videoFormat) ;
		let readOffset = 0 ;
		while( !this.isReady() ) {
			const { data, newOffset } = await mediaReader.buildFromOffset(readOffset) ;
			if( data==null ) {
				break ;
			}
			this.streamData(data) ;
			readOffset = newOffset ;
		}
	}
	
	
	isReady() {
		return ( Object.keys(this.map_nalType_data).length == this.getTypesCSD().length ) ;
	}
	
	getTypesCSD() {
		switch( this.videoFormat ) {
			case 'hevc' :
				return [32,33,34];
				
			case 'avc' :
				return [7,8];
		}
	}
	isKeyFrame(nals) {
		switch( this.videoFormat ) {
			case 'hevc' :
				for (const nalDesc of nals) {
					if( (nalDesc.type >= 16) && (nalDesc.type < 24) ) {
						return true ;
					}
				}
				return false ;
				
			case 'avc' :
				for (const nalDesc of nals) {
					if( nalDesc.type==5 ) {
						return true ;
					}
				}
				return false ;
		}
		return false;
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
              unit = {rawdata: uarray.subarray(lastUnitStart - state - 1, i - state - 1 ), type: lastUnitType}; 
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
      unit = {rawdata: uarray.subarray(lastUnitStart - state - 1, len), type: lastUnitType, state : state};
      units.push(unit); 
    }

    return units;
	}
	
	streamData( data ) {
		// extract NALs from data
		const localMap_nalType_data = {} ;
		const nals = this.getNalUnits(data);
		const nalTypesCSD = this.getTypesCSD();
		for (const nalDesc of nals) {
			if( nalTypesCSD.includes(nalDesc.type) ) {
				this.map_nalType_data[nalDesc.type] = nalDesc.rawdata ;
				localMap_nalType_data[nalDesc.type] = nalDesc.rawdata ;
			}
		}
		
		// is Key frame ? + has codec setup data ? + if not => write extra NALs
		if( this.isKeyFrame(nals) && this.isReady()
			&& (Object.keys(localMap_nalType_data).length < this.getTypesCSD().length) ) {
			
			const arrData = [] ;
			for( const nalType of this.getTypesCSD() ) {
				arrData.push(this.map_nalType_data[nalType]) ;
			}
			arrData.push(data) ;
			return Buffer.concat(arrData);
		}
		
		return data ;
	}

}

export default h264streamer ;
