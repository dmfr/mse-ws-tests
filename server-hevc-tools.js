export function hevcDiscardNalSeparator( data ) {
	if( data[0]==0 && data[1]==0 ) {
		if( data[2]==1 ) {
			data = data.subarray(3) ;
		}
		if( data[2]==0 && data[3]==1 ) {
			data = data.subarray(4) ;
		}
	}
	return data ;
}

export function hevcGetNalType( data ) {
	data = hevcDiscardNalSeparator(data) ;
	const firstByte = data[0] ;
	const type = (firstByte & 0x7E) >> 1;
	return type ;
}
export function hevcIsIRAP(data) {
	data = hevcDiscardNalSeparator(data) ;
	var nalType = hevcGetNalType(data) ;
	if( (nalType >= 16) && (nalType < 24) ) {
		return true ;
	}
	return false ;
}
export function hevcIsVCL(data) {
	data = hevcDiscardNalSeparator(data) ;
	var nalType = hevcGetNalType(data) ;
	if( nalType < 32 ) {
		return true ;
	}
	return false ;
}
export function hevcIsSPS(data) {
	data = hevcDiscardNalSeparator(data) ;
	if( hevcGetNalType(data) == 33 ) {
		return true ;
	}
	return false ;
}
export function hevcIsVCLfirst(data) {
	data = hevcDiscardNalSeparator(data) ;
	if( !hevcIsVCL(data) ) {
		return false ;
	}
	
	// skip type + misc : 2 first bytes
	data = data.subarray(2) ;
	// first value for VLC is first_mb_in_slice
	// ..has to be 0 for first slice
	// check if first bit is 1 ==> decoded value is 0
	if( data[0] >> 7 == 1 ) {
		return true ;
	}
}
