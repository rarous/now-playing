class ShazamProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0][0];
    this.port.postMessage(input);
    return true;
  }
}

registerProcessor("shazam-processor", ShazamProcessor);
