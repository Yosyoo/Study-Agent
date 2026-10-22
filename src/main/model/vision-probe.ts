import { randomInt } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'

const palette = [
  { name: 'red', rgb: [230, 25, 25] },
  { name: 'green', rgb: [0, 160, 40] },
  { name: 'blue', rgb: [25, 65, 230] },
  { name: 'yellow', rgb: [245, 220, 0] },
  { name: 'purple', rgb: [145, 35, 190] },
  { name: 'orange', rgb: [250, 130, 0] },
] as const

function chunk(type: string, data: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(payload))
  return Buffer.concat([length, payload, checksum])
}

/** Random answers live only in pixels; the request never supplies the expected order. */
export function createVisionProbe(): { image: string; colors: string[] } {
  const remaining = [...palette]
  const colors = Array.from({ length: 3 }, () => remaining.splice(randomInt(remaining.length), 1)[0])
  const width = 360, height = 140
  const pixels = Buffer.alloc((width * 3 + 1) * height, 255)
  for (let y = 0; y < height; y++) {
    pixels[y * (width * 3 + 1)] = 0 // PNG filter: none
    for (let x = 0; x < width; x++) {
      const index = Math.floor(x / 120)
      if (x % 120 < 20 || x % 120 >= 100 || y < 30 || y >= 110) continue
      const offset = y * (width * 3 + 1) + 1 + x * 3
      colors[index].rgb.forEach((channel, i) => { pixels[offset + i] = channel })
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 2 // 8-bit RGB
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
  return { image: `data:image/png;base64,${png.toString('base64')}`, colors: colors.map(color => color.name) }
}
