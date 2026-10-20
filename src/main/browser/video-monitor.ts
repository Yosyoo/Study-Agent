import type { VideoSample, VideoState, VideoStatus } from '../../shared/contracts'

interface Progress { position: number; lastProgressAt: number }

/** Derives playback health from observed media properties. Never changes playback. */
export class VideoTracker {
  private progress = new Map<string, Progress>()

  constructor(private readonly stallThresholdMs = 15_000) {}

  reset(): void { this.progress.clear() }

  update(samples: VideoSample[]): VideoState[] {
    const present = new Set(samples.map(sample => sample.id))
    for (const id of this.progress.keys()) if (!present.has(id)) this.progress.delete(id)
    return samples.map(sample => {
      const previous = this.progress.get(sample.id)
      const moved = !previous || Math.abs(sample.currentTime - previous.position) >= 0.15
      const inactive = sample.paused || sample.ended || sample.error !== null
      const lastProgressAt = moved || inactive ? sample.sampledAt : previous.lastProgressAt
      this.progress.set(sample.id, { position: moved ? sample.currentTime : previous!.position, lastProgressAt })
      const stalledForMs = Math.max(0, sample.sampledAt - lastProgressAt)
      let status: VideoStatus
      if (sample.error || sample.networkState === 3) status = 'error'
      else if (sample.ended) status = 'ended'
      else if (sample.paused) status = 'paused'
      else if (stalledForMs >= this.stallThresholdMs) status = 'stalled'
      else if (sample.readyState < 3) status = 'buffering'
      else status = 'playing'
      return { ...sample, status, stalledForMs }
    })
  }
}
