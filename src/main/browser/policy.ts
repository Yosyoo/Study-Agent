/** Only explicitly supported learning sites and opt-in test origins may be controlled. */
export function urlAllowed(raw: string, additionalOrigins: string[] = []): boolean {
  try {
    const url = new URL(raw)
    if (url.username || url.password) return false
    if (additionalOrigins.includes(url.origin) && ['http:', 'https:'].includes(url.protocol)) return true
    return url.protocol === 'https:' && !url.port && ['chaoxing.com', 'xueyinonline.com'].some(
      domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    )
  } catch { return false }
}

export function mapPoint(x: number, y: number, viewport: { width: number; height: number }): { x: number; y: number } {
  if (![x, y, viewport.width, viewport.height].every(Number.isFinite) || x < 0 || x > 1000 || y < 0 || y > 1000 || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error('无效的截图坐标或视口尺寸。')
  }
  return { x: Math.min(viewport.width - 1, x * viewport.width / 1000), y: Math.min(viewport.height - 1, y * viewport.height / 1000) }
}
