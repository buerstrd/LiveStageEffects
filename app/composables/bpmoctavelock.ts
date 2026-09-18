export interface BpmOctaveLockResult {
  bpm: number
  switched: boolean
  suppressed: boolean
}

export interface BpmOctaveLockOptions {
  minBpm: number
  maxBpm: number
  matchTolerance: number
  switchHoldMs: number
  switchMinSamples: number
  switchMinConfidence: number
}

const DEFAULT_OPTIONS: BpmOctaveLockOptions = {
  minBpm: 55,
  maxBpm: 200,
  matchTolerance: 0.08,
  switchHoldMs: 3000,
  switchMinSamples: 5,
  switchMinConfidence: 0.72
}

const OCTAVE_RATIOS = [0.5, 1, 2] as const

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value))
}

export const createBpmOctaveLock = (
  overrides: Partial<BpmOctaveLockOptions> = {}
) => {
  const options = {
    ...DEFAULT_OPTIONS,
    ...overrides
  }
  let lockedBpm: number | null = null
  let pendingBpm: number | null = null
  let pendingSince = 0
  let pendingSamples = 0
  let pendingConfidenceSum = 0

  const clearPending = () => {
    pendingBpm = null
    pendingSince = 0
    pendingSamples = 0
    pendingConfidenceSum = 0
  }

  const reset = () => {
    lockedBpm = null
    clearPending()
  }

  const lockTo = (bpm: number) => {
    if (!Number.isFinite(bpm) || bpm <= 0) return false

    lockedBpm = clamp(bpm, options.minBpm, options.maxBpm)
    clearPending()
    return true
  }

  const findOctaveRatio = (candidateBpm: number, referenceBpm: number) => {
    let matchedRatio: number | null = null
    let matchedError = Number.POSITIVE_INFINITY

    for (const ratio of OCTAVE_RATIOS) {
      const targetBpm = referenceBpm * ratio
      if (
        targetBpm < options.minBpm - 1e-6
        || targetBpm > options.maxBpm + 1e-6
      ) {
        continue
      }

      const error = Math.abs(candidateBpm - targetBpm) / targetBpm
      if (error <= options.matchTolerance && error < matchedError) {
        matchedRatio = ratio
        matchedError = error
      }
    }

    return matchedRatio
  }

  const stabilize = (
    candidateBpm: number,
    confidence: number,
    now: number
  ): BpmOctaveLockResult => {
    if (!Number.isFinite(candidateBpm) || candidateBpm <= 0) {
      return {
        bpm: lockedBpm ?? options.minBpm,
        switched: false,
        suppressed: lockedBpm !== null
      }
    }

    const boundedBpm = clamp(
      candidateBpm,
      options.minBpm,
      options.maxBpm
    )
    if (lockedBpm === null) {
      lockedBpm = boundedBpm
      clearPending()
      return {
        bpm: boundedBpm,
        switched: false,
        suppressed: false
      }
    }

    const currentBpm = lockedBpm
    const octaveRatio = findOctaveRatio(boundedBpm, currentBpm)
    if (octaveRatio === null || octaveRatio === 1) {
      lockedBpm = boundedBpm
      clearPending()
      return {
        bpm: boundedBpm,
        switched: false,
        suppressed: false
      }
    }

    const safeConfidence = Number.isFinite(confidence)
      ? clamp(confidence, 0, 1)
      : 0
    const pendingReference = pendingBpm
    if (
      pendingReference === null
      || Math.abs(boundedBpm - pendingReference) / pendingReference
        > options.matchTolerance
    ) {
      pendingBpm = boundedBpm
      pendingSince = now
      pendingSamples = 1
      pendingConfidenceSum = safeConfidence
    } else {
      pendingBpm = pendingReference
        + (boundedBpm - pendingReference) * 0.25
      pendingSamples += 1
      pendingConfidenceSum += safeConfidence
    }

    const averageConfidence = pendingConfidenceSum
      / Math.max(1, pendingSamples)
    if (
      pendingSamples >= options.switchMinSamples
      && now - pendingSince >= options.switchHoldMs
      && averageConfidence >= options.switchMinConfidence
    ) {
      const switchedBpm = clamp(
        pendingBpm ?? boundedBpm,
        options.minBpm,
        options.maxBpm
      )
      lockedBpm = switchedBpm
      clearPending()
      return {
        bpm: switchedBpm,
        switched: true,
        suppressed: false
      }
    }

    return {
      bpm: currentBpm,
      switched: false,
      suppressed: true
    }
  }

  return {
    lockTo,
    reset,
    stabilize
  }
}
