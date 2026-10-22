import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { createVisionProbe } from '../src/main/model/vision-probe'

describe('visual connection challenge', () => {
  it('encodes a valid RGB PNG with the expected answer present only as pixels', () => {
    const probe = createVisionProbe()
    const bytes = Buffer.from(probe.image.split(',')[1], 'base64')
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const data: Buffer[] = []
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset)
      const type = bytes.subarray(offset + 4, offset + 8).toString()
      if (type === 'IDAT') data.push(bytes.subarray(offset + 8, offset + 8 + length))
      offset += length + 12
    }
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    expect([width, height]).toEqual([360, 140])
    const decoded = inflateSync(Buffer.concat(data))
    const names: Record<string, string> = { '230,25,25': 'red', '0,160,40': 'green', '25,65,230': 'blue', '245,220,0': 'yellow', '145,35,190': 'purple', '250,130,0': 'orange' }
    const answers = [60, 180, 300].map(x => {
      const position = 70 * (width * 3 + 1) + 1 + x * 3
      return names[Array.from(decoded.subarray(position, position + 3)).join(',')]
    })
    expect(answers).toEqual(probe.colors)
    expect(new Set(answers).size).toBe(3)
    for (const color of probe.colors) expect(bytes.includes(Buffer.from(color))).toBe(false)
  })
})
