const ACT_WINDOW = 500;
const MIN_WINDOW = 250;
const EVAL_INTERVAL = 25;
const ENTER_SCORE = 0.64;
const EXIT_SCORE = 0.28;
const ENTER_WINDOWS = 4;
const EXIT_WINDOWS = 6;
const MIN_BPM = 55;
const MAX_BPM = 200;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export class MusicGate {
  constructor(fps = 100) {
    this.fps = fps;
    this.activation = new Float32Array(ACT_WINDOW);
    this.lowEnergy = new Float32Array(ACT_WINDOW);
    this.activationScratch = new Float64Array(ACT_WINDOW);
    this.lowEnergyScratch = new Float64Array(ACT_WINDOW);
    this.position = 0;
    this.fill = 0;
    this.frame = 0;
    this.score = 0;
    this.lowRatio = 0;
    this.flatness = 0;
    this.periodicity = 0;
    this.isMusic = null;
    this.enterCount = 0;
    this.exitCount = 0;
    this._hasFeatures = false;
  }

  reset() {
    this.activation.fill(0);
    this.lowEnergy.fill(0);
    this.position = 0;
    this.fill = 0;
    this.frame = 0;
    this.score = 0;
    this.lowRatio = 0;
    this.flatness = 0;
    this.periodicity = 0;
    this.isMusic = null;
    this.enterCount = 0;
    this.exitCount = 0;
    this._hasFeatures = false;
  }

  process(tracker, grid) {
    const spectrum = tracker.features.specLinear;
    const frequencies = tracker.features.fb.centerFreqs;
    let totalEnergy = 0;
    let lowEnergy = 0;
    let arithmeticSum = 0;
    let logSum = 0;

    for (let index = 0; index < spectrum.length; index++) {
      const energy = Math.max(spectrum[index], 1e-12);
      totalEnergy += energy;
      arithmeticSum += energy;
      logSum += Math.log(energy);
      if (frequencies[index] <= 250) {
        lowEnergy += energy;
      }
    }

    const lowRatio = lowEnergy / Math.max(totalEnergy, 1e-12);
    const flatness = Math.exp(logSum / spectrum.length)
      / Math.max(arithmeticSum / spectrum.length, 1e-12);

    if (!this._hasFeatures) {
      this.lowRatio = lowRatio;
      this.flatness = flatness;
      this._hasFeatures = true;
    } else {
      this.lowRatio += (lowRatio - this.lowRatio) * 0.08;
      this.flatness += (flatness - this.flatness) * 0.08;
    }

    this.activation[this.position] = clamp(tracker.activation, 0, 1);
    this.lowEnergy[this.position] = clamp(lowRatio, 0, 1);
    this.position = (this.position + 1) % ACT_WINDOW;
    this.fill = Math.min(ACT_WINDOW, this.fill + 1);
    this.frame += 1;

    if (
      this.fill >= MIN_WINDOW
      && this.frame % EVAL_INTERVAL === 0
    ) {
      this._evaluate(tracker, grid);
    }

    return {
      isMusic: this.isMusic,
      score: this.score,
      lowRatio: this.lowRatio,
      flatness: this.flatness,
      periodicity: this.periodicity
    };
  }

  _evaluate(tracker, grid) {
    const count = Math.min(this.fill, ACT_WINDOW);
    this._copyChronological(this.activation, this.activationScratch, count);
    this._copyChronological(this.lowEnergy, this.lowEnergyScratch, count);

    const activationPeriodicity = this._autocorrelation(
      this.activationScratch,
      count
    );
    const lowEnergyPeriodicity = this._autocorrelation(
      this.lowEnergyScratch,
      count
    );
    // Vocals often weaken the low-frequency periodicity even when the beat is
    // clear. Keep the model activation as an equally valid source so tracks
    // with vocals are not pushed towards the non-music gate.
    this.periodicity = Math.max(
      lowEnergyPeriodicity * 0.65 + activationPeriodicity * 0.35,
      activationPeriodicity * 0.9
    );

    const lowScore = smoothstep(0.28, 0.68, this.lowRatio);
    const flatnessScore = 1 - smoothstep(0.35, 0.78, this.flatness);
    const shapeScore = smoothstep(2.5, 9, tracker.shape);
    const periodicityScore = smoothstep(0.18, 0.58, this.periodicity);
    const confidenceScore = smoothstep(0.38, 0.68, grid.confidence);
    const energyScore = smoothstep(0.015, 0.12, tracker.energy);
    const rhythmicScore = (
      periodicityScore * 0.45
      + confidenceScore * 0.35
      + shapeScore * 0.2
    );
    const timbreScore = lowScore * 0.65 + flatnessScore * 0.35;
    const baseScore = (
      rhythmicScore * 0.8
      + timbreScore * 0.2
    );
    const timbreReliability = 0.9 + timbreScore * 0.1;
    const beatEvidence = (
      confidenceScore
      * (0.65 + shapeScore * 0.35)
      * (0.7 + periodicityScore * 0.3)
      * (0.88 + timbreScore * 0.12)
    );
    const baseProbability = baseScore * timbreReliability;
    const rawScore = (
      1 - (1 - baseProbability) * (1 - beatEvidence)
    ) * energyScore;

    this.score += (rawScore - this.score) * 0.35;

    if (this.score >= ENTER_SCORE) {
      this.enterCount += 1;
      this.exitCount = 0;
    } else if (this.score <= EXIT_SCORE) {
      this.exitCount += 1;
      this.enterCount = 0;
    }

    if (this.isMusic !== true && this.enterCount >= ENTER_WINDOWS) {
      this.isMusic = true;
      this.exitCount = 0;
    } else if (this.isMusic !== false && this.exitCount >= EXIT_WINDOWS) {
      this.isMusic = false;
      this.enterCount = 0;
    }
  }

  _copyChronological(source, target, count) {
    const start = (this.position - count + ACT_WINDOW) % ACT_WINDOW;
    for (let index = 0; index < count; index++) {
      target[index] = source[(start + index) % ACT_WINDOW];
    }
  }

  _autocorrelation(values, count) {
    const minLag = Math.max(1, Math.round(this.fps * 60 / MAX_BPM));
    const maxLag = Math.min(
      count - 1,
      Math.round(this.fps * 60 / MIN_BPM)
    );
    if (maxLag <= minLag) return 0;

    let mean = 0;
    for (let index = 0; index < count; index++) {
      mean += values[index];
    }
    mean /= count;

    let variance = 0;
    for (let index = 0; index < count; index++) {
      const delta = values[index] - mean;
      variance += delta * delta;
    }
    if (variance <= 1e-9) return 0;

    let peak = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let correlation = 0;
      for (let index = lag; index < count; index++) {
        correlation += (
          (values[index] - mean)
          * (values[index - lag] - mean)
        );
      }
      peak = Math.max(peak, correlation / variance);
    }
    return clamp(peak, 0, 1);
  }
}
