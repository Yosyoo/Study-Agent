import { describe, expect, it } from 'vitest'
import { VideoTracker } from '../src/main/browser/video-monitor'
import type { VideoSample } from '../src/shared/contracts'

const sample = (overrides: Partial<VideoSample> = {}): VideoSample => ({
  id: 'frame:0', frameId: 'frame', currentTime: 10, duration: 100,
  paused: false, ended: false, readyState: 4, networkState: 1,
  playbackRate: 1, bufferedEnd: 30, error: null, sampledAt: 1000,
  ...overrides,
})

describe('video state monitor', () => {
  it('uses actual progress across observations to distinguish playing and stalled', () => {
    const tracker = new VideoTracker(15_000)
    expect(tracker.update([sample()])[0].status).toBe('playing')
    expect(tracker.update([sample({ sampledAt: 11_000, currentTime: 20 })])[0].status).toBe('playing')
    expect(tracker.update([sample({ sampledAt: 25_000, currentTime: 20 })])[0].status).toBe('playing')
    expect(tracker.update([sample({ sampledAt: 26_000, currentTime: 20 })])[0]).toMatchObject({ status: 'stalled', stalledForMs: 15_000 })
    expect(tracker.update([sample({ sampledAt: 27_000, currentTime: 21 })])[0].status).toBe('playing')
  })
  it('identifies buffering, paused, ended and media errors independently', () => {
    const tracker = new VideoTracker()
    expect(tracker.update([sample({ readyState: 2 })])[0].status).toBe('buffering')
    expect(tracker.update([sample({ paused: true })])[0].status).toBe('paused')
    expect(tracker.update([sample({ paused: true, ended: true, currentTime: 100 })])[0].status).toBe('ended')
    expect(tracker.update([sample({ error: 'MEDIA_ERR_2' })])[0].status).toBe('error')
    expect(tracker.update([sample({ networkState: 3 })])[0].status).toBe('error')
  })
  it('does not treat a long user pause as a playback stall', () => {
    const tracker = new VideoTracker()
    tracker.update([sample({ paused: true })])
    tracker.update([sample({ paused: true, sampledAt: 100_000 })])
    expect(tracker.update([sample({ sampledAt: 101_000 })])[0].status).toBe('playing')
  })
  it('drops disappeared players and clears history on reset', () => {
    const tracker = new VideoTracker()
    tracker.update([sample()])
    expect(tracker.update([])).toEqual([])
    expect(tracker.update([sample({ sampledAt: 100_000 })])[0].status).toBe('playing')
    tracker.reset()
    expect(tracker.update([sample({ sampledAt: 200_000 })])[0].status).toBe('playing')
  })
})
