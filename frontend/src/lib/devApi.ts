/** Local scrape API exists only under Vite dev/preview — not on static hosts (Netlify, etc.). */
export function canUseLocalAnjukeRefresh(): boolean {
  if (import.meta.env.DEV) return true
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

/** Vite dev/preview middleware (see `server/anjukeRefreshHandler.ts`). */
export function devAnjukeRefreshApiUrl(subpath: '' | '/status' | '/test' = ''): string {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}api/dev/anjuke-refresh${subpath}`
}

export async function fetchDevJson<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : 'Network error',
    }
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    const snippet = text.trimStart().slice(0, 60)
    const isHtml = snippet.startsWith('<!DOCTYPE') || snippet.startsWith('<!doctype') || snippet.startsWith('<html')
    return {
      ok: false,
      status: res.status,
      error: isHtml
        ? canUseLocalAnjukeRefresh()
          ? 'Dev API returned HTML instead of JSON. Restart `npm run dev` in frontend/ and try again.'
          : 'This site is a static deploy (e.g. Netlify). Cookie test and local refresh only work with `cd frontend && npm run dev` on your machine, or use GitHub Actions below.'
        : `Expected JSON (HTTP ${res.status}): ${snippet}`,
    }
  }

  try {
    const data = (await res.json()) as T
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return {
      ok: false,
      status: res.status,
      error: e instanceof Error ? e.message : 'Invalid JSON response',
    }
  }
}
