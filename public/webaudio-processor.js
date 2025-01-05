class CircularBuffer {
	constructor(Mtype,size) {
		this.memory = new Mtype(size);
		this.head = 0;
		this.tail = 0;
		this.isFull = false;
	}

	read() {
		if (this.tail === this.head && !this.isFull) {
			//console.log('Nothing to read.');
			return null ;
		} 
		
		const r = this.memory[this.tail] ;
		this.isFull = false;
		this.tail = this.next(this.tail);
		return r ;
	}

	write(value) {
		this.memory[this.head] = value;
		this.head = this.next(this.head);
		if( this.isFull ) {
			this.tail = this.next(this.tail);
		}
		if( this.head === this.tail ) {
			if( !this.isFull ) {
				//console.log('buffer is now full');
			}
			this.isFull = true;
		}
	}

	next(n) {
		var nxt = n + 1;
		if (nxt === this.memory.length) {
			return 0;
		} else {
			return nxt;
		}
	}
	
	occupied() {
		if( this.isFull ) {
			return this.memory.length;
		}
		if( this.head < this.tail ) {
			return this.head + this.memory.length - this.tail ;
		}
		return this.head - this.tail ;
	}
	size() {
		return this.memory.length;
	}
}

class WebaudioProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super();
		
		this.baseSampleSize = 1024 ;
		this.outputChannelCount = options.processorOptions.outputChannelCount ;
		
		this.buffer = new CircularBuffer(Float32Array,4*this.baseSampleSize*this.outputChannelCount) ;
		
		//set listener to receive audio data
		this.port.onmessage = (msg) => {
			//console.log('filling buffer') ;
			const interleavingBuffers = msg.data ;
			//console.dir(interleavingBuffers) ;
			const nbOfSamples = interleavingBuffers[0].length ;
			
			for( var i=0 ; i<nbOfSamples ; i++ ) {
				for( var j=0 ; j<this.outputChannelCount ; j++ ) {
					const sIdx = i ;
					const cIdx = j % interleavingBuffers.length;
					this.buffer.write(interleavingBuffers[cIdx][sIdx]);
				}
			}
			//console.dir(this.buffer) ;
			//console.log('end of fill buffer');
		}
	}
	process(inputs, outputs, parameters) {
		//console.log('process');
		// console.log( 'nb of outputs = '+outputs.length ) ;
		// console.dir( this.buffer ) ;
		const output = outputs[0];
		const nbOfSamples = output[0].length ;
		
		//console.log( 'size is' + this.buffer.size() ) ;
		if( this.buffer.occupied() < this.baseSampleSize*this.outputChannelCount ) {
			// for( var i=0 ; i<nbOfSamples ; i++ ) {
			// 	for( var j=0 ; j<this.outputChannelCount ; j++ ) {
			// 		const sIdx = i ;
			// 		const cIdx = j ;
			// 		output[cIdx][sIdx] = 0;
			// 	}
			// }
			return true ;
		}
		
		for( var i=0 ; i<nbOfSamples ; i++ ) {
			for( var j=0 ; j<this.outputChannelCount ; j++ ) {
				const sIdx = i ;
				const cIdx = j ;
				output[cIdx][sIdx] = this.buffer.read();
			}
		}
		return true;
	}
}

registerProcessor("webaudio-processor", WebaudioProcessor);
