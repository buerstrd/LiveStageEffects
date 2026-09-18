// Converts the AudioWorklet's native sample rate to madmom's 44100 Hz stream,
// then collects 441-sample hops for the beat tracker.

const TARGET_SAMPLE_RATE = 44100;
const HOP = 441;

class HopCollector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(HOP);
    this.filled = 0;
    this.inputRate = typeof sampleRate === 'number' && sampleRate > 0
      ? sampleRate
      : TARGET_SAMPLE_RATE;
    this.ratio = this.inputRate / TARGET_SAMPLE_RATE;
    this.nextOutputIndex = 0;
    this.previousSample = null;
    this.inputIndex = -1;
    this.hopStartTime = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const firstChannel = input[0];
    if (!firstChannel) return true;
    const channelCount = input.length;
    const blockStartTime = typeof currentTime === 'number' ? currentTime : 0;

    for (let index = 0; index < firstChannel.length; index++) {
      let sample = 0;
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
        sample += input[channelIndex]?.[index] ?? 0;
      }
      sample /= channelCount;
      this.inputIndex += 1;

      if (this.previousSample === null) {
        this.previousSample = sample;
        continue;
      }

      while (this.nextOutputIndex <= this.inputIndex) {
        const previousIndex = this.inputIndex - 1;
        const mix = Math.max(
          0,
          Math.min(1, this.nextOutputIndex - previousIndex)
        );
        if (this.filled === 0) {
          this.hopStartTime = blockStartTime + index / this.inputRate;
        }
        this.buf[this.filled] = this.previousSample
          + (sample - this.previousSample) * mix;
        this.filled += 1;
        this.nextOutputIndex += this.ratio;

        if (this.filled === HOP) {
          // A copy is transferred so the buffer can be reused immediately.
          const out = this.buf.slice();
          this.port.postMessage(
            { hop: out, time: this.hopStartTime },
            [out.buffer]
          );
          this.filled = 0;
        }
      }

      this.previousSample = sample;
    }

    return true;
  }
}

registerProcessor('beattracker-hop-collector', HopCollector);
