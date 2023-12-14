export function getAudioConfig (data, offset) {
  let adtsObjectType, // :int
    adtsSampleingIndex, // :int
    adtsExtensionSampleingIndex, // :int
    adtsChanelConfig, // :int
    config,
    adtsSampleingRates = [
      96000, 88200,
      64000, 48000,
      44100, 32000,
      24000, 22050,
      16000, 12000,
      11025, 8000,
      7350];
  // byte 2
  adtsObjectType = ((data[offset + 2] & 0xC0) >>> 6) + 1;
  adtsSampleingIndex = ((data[offset + 2] & 0x3C) >>> 2);
  adtsChanelConfig = ((data[offset + 2] & 0x01) << 2);
  // byte 3
  adtsChanelConfig |= ((data[offset + 3] & 0xC0) >>> 6);

    /*  for other browsers (Chrome/Vivaldi/Opera ...)
        always force audio type to be HE-AAC SBR, as some browsers do not support audio codec switch properly (like Chrome ...)
    */
	 /*
    adtsObjectType = 5;
	 */
    
  
  /* refer to http://wiki.multimedia.cx/index.php?title=MPEG-4_Audio#Audio_Specific_Config
      ISO 14496-3 (AAC).pdf - Table 1.13 — Syntax of AudioSpecificConfig()
    Audio Profile / Audio Object Type
    0: Null
    1: AAC Main
    2: AAC LC (Low Complexity)
    3: AAC SSR (Scalable Sample Rate)
    4: AAC LTP (Long Term Prediction)
    5: SBR (Spectral Band Replication)
    6: AAC Scalable
   sampling freq
    0: 96000 Hz
    1: 88200 Hz
    2: 64000 Hz
    3: 48000 Hz
    4: 44100 Hz
    5: 32000 Hz
    6: 24000 Hz
    7: 22050 Hz
    8: 16000 Hz
    9: 12000 Hz
    10: 11025 Hz
    11: 8000 Hz
    12: 7350 Hz
    13: Reserved
    14: Reserved
    15: frequency is written explictly
    Channel Configurations
    These are the channel configurations:
    0: Defined in AOT Specifc Config
    1: 1 channel: front-center
    2: 2 channels: front-left, front-right
  */
  config = new Array(2);
  // audioObjectType = profile => profile, the MPEG-4 Audio Object Type minus 1
  config[0] = adtsObjectType << 3;
  // samplingFrequencyIndex
  config[0] |= (adtsSampleingIndex & 0x0E) >> 1;
  config[1] |= (adtsSampleingIndex & 0x01) << 7;
  // channelConfiguration
  config[1] |= adtsChanelConfig << 3;
  return { config: config, samplerate: adtsSampleingRates[adtsSampleingIndex], channelCount: adtsChanelConfig, codec: ('mp4a.40.' + adtsObjectType) };
}

export function isHeaderPattern (data, offset) {
  return data[offset] === 0xff && (data[offset + 1] & 0xf6) === 0xf0;
}

export function getHeaderLength (data, offset) {
  return (data[offset + 1] & 0x01 ? 7 : 9);
}

export function getFullFrameLength (data, offset) {
  return ((data[offset + 3] & 0x03) << 11) |
    (data[offset + 4] << 3) |
    ((data[offset + 5] & 0xE0) >>> 5);
}

export function isHeader (data, offset) {
  // Look for ADTS header | 1111 1111 | 1111 X00X | where X can be either 0 or 1
  // Layer bits (position 14 and 15) in header should be always 0 for ADTS
  // More info https://wiki.multimedia.cx/index.php?title=ADTS
  if (offset + 1 < data.length && isHeaderPattern(data, offset)) {
    return true;
  }

  return false;
}

export function probe (data, offset) {
  // same as isHeader but we also check that ADTS frame follows last ADTS frame
  // or end of data is reached
  if (offset + 1 < data.length && isHeaderPattern(data, offset)) {
    // ADTS header Length
    let headerLength = getHeaderLength(data, offset);
    // ADTS frame Length
    let frameLength = headerLength;
    if (offset + 5 < data.length) {
      frameLength = getFullFrameLength(data, offset);
    }

    let newOffset = offset + frameLength;
    if (newOffset === data.length || (newOffset + 1 < data.length && isHeaderPattern(data, newOffset))) {
      return true;
    }
  }
  return false;
}

export function initTrackConfig (track, observer, data, offset, audioCodec) {
  if (!track.samplerate) {
    let config = getAudioConfig(observer, data, offset, audioCodec);
    track.config = config.config;
    track.samplerate = config.samplerate;
    track.channelCount = config.channelCount;
    track.codec = config.codec;
    track.manifestCodec = config.manifestCodec;
    logger.log(`parsed codec:${track.codec},rate:${config.samplerate},nb channel:${config.channelCount}`);
  }
}

export function getFrameDuration (samplerate) {
  return 1024 * 90000 / samplerate;
}

export function parseFrameHeader (data, offset, pts, frameIndex, frameDuration) {
  let headerLength, frameLength, stamp;
  let length = data.length;

  // The protection skip bit tells us if we have 2 bytes of CRC data at the end of the ADTS header
  headerLength = getHeaderLength(data, offset);
  // retrieve frame size
  frameLength = getFullFrameLength(data, offset);
  frameLength -= headerLength;

  if ((frameLength > 0) && ((offset + headerLength + frameLength) <= length)) {
    stamp = pts + frameIndex * frameDuration;
    // logger.log(`AAC frame, offset/length/total/pts:${offset+headerLength}/${frameLength}/${data.byteLength}/${(stamp/90).toFixed(0)}`);
    return { headerLength, frameLength, stamp };
  }

  return undefined;
}

export function appendFrame (track, data, offset, pts, frameIndex) {
  let frameDuration = getFrameDuration(track.samplerate);
  let header = parseFrameHeader(data, offset, pts, frameIndex, frameDuration);
  if (header) {
    let stamp = header.stamp;
    let headerLength = header.headerLength;
    let frameLength = header.frameLength;

    // logger.log(`AAC frame, offset/length/total/pts:${offset+headerLength}/${frameLength}/${data.byteLength}/${(stamp/90).toFixed(0)}`);
    let aacSample = {
      unit: data.subarray(offset + headerLength, offset + headerLength + frameLength),
      pts: stamp,
      dts: stamp
    };

    track.samples.push(aacSample);
    track.len += frameLength;

    return { sample: aacSample, length: frameLength + headerLength };
  }

  return undefined;
} 
