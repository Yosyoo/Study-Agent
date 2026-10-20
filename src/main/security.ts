/** Keep operational diagnostics useful without copying credentials or URL tokens into logs. */
export function redact(message: string): string {
  return message
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)/gi, '[REDACTED]')
    .replace(/(api[_-]?key|authorization|password|token|cookie|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/g, raw => {
      try { const url = new URL(raw); return `${url.origin}${url.pathname}${url.search ? '?[REDACTED]' : ''}` }
      catch { return '[URL]' }
    }).slice(0, 2000)
}

export function isTrustedRendererUrl(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual), e = new URL(expected)
    return a.protocol === e.protocol && a.origin === e.origin && a.host === e.host
      && a.username === e.username && a.password === e.password && a.pathname === e.pathname && !a.search
  } catch { return false }
}

export function validateApiKey(raw: string): string {
  const key = raw.trim()
  if (!key || key.length > 8192 || /[\r\n\u0000-\u0020\u007f]/.test(key)) throw new Error('API Key 应为单行、不含空格的有效密钥。')
  return key
}
