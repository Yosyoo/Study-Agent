import { describe, expect, it } from 'vitest'
import { mapPoint, urlAllowed } from '../src/main/browser/policy'
import { detectPageType } from '../src/main/browser/controller'

const emptyHints = { password: false, exercise: false, chapterLinks: 0, courseLinks: 0, headingKind: '' }

describe('browser URL boundary', () => {
  it('allows only HTTPS platform domains and rejects lookalikes, credentials, file and javascript schemes', () => {
    expect(urlAllowed('https://mooc2-ans.chaoxing.com/visit/courses/list')).toBe(true)
    expect(urlAllowed('https://www.xueyinonline.com/course')).toBe(true)
    for (const url of ['http://chaoxing.com', 'https://chaoxing.com.attacker.test', 'https://attackerchaoxing.com', 'https://u:p@chaoxing.com', 'file:///etc/passwd', 'javascript:alert(1)', 'https://127.0.0.1:8443']) expect(urlAllowed(url)).toBe(false)
  })
  it('requires explicit origin opt-in for local browser fixtures', () => {
    expect(urlAllowed('http://127.0.0.1:43125/course')).toBe(false)
    expect(urlAllowed('http://127.0.0.1:43125/course', ['http://127.0.0.1:43125'])).toBe(true)
    expect(urlAllowed('http://127.0.0.1:43126/course', ['http://127.0.0.1:43125'])).toBe(false)
  })
})

describe('coordinate mapping', () => {
  it('maps normalized screenshot coordinates to CSS viewport pixels including clipped edge', () => {
    expect(mapPoint(500, 250, { width: 1280, height: 800 })).toEqual({ x: 640, y: 200 })
    expect(mapPoint(1000, 1000, { width: 1280, height: 800 })).toEqual({ x: 1279, y: 799 })
  })
  it('rejects out-of-range or nonfinite model coordinates', () => {
    for (const x of [-1, 1001, NaN, Infinity]) expect(() => mapPoint(x, 0, { width: 1280, height: 800 })).toThrow()
  })
})

describe('conservative page classifier', () => {
  it('prioritizes visible login controls over other evidence', () => {
    expect(detectPageType('https://chaoxing.com', { ...emptyHints, password: true, exercise: true }, 1).pageType).toBe('login')
  })
  it('recognizes video, chapter and course evidence without depending on question text', () => {
    expect(detectPageType('https://chaoxing.com', emptyHints, 1).pageType).toBe('video')
    expect(detectPageType('https://chaoxing.com', { ...emptyHints, chapterLinks: 2 }, 0).pageType).toBe('chapters')
    expect(detectPageType('https://chaoxing.com', { ...emptyHints, courseLinks: 3 }, 0).pageType).toBe('courses')
    expect(detectPageType('https://chaoxing.com', { ...emptyHints, exercise: true }, 0).pageType).toBe('exercise')
  })
  it('keeps unfamiliar pages unknown instead of inventing adapter certainty', () => {
    expect(detectPageType('https://chaoxing.com/something-new', emptyHints, 0)).toEqual({ pageType: 'unknown', confidence: 0.1 })
  })
})
