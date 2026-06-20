import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Connect } from 'vite'

const ROOT = path.resolve(__dirname, '../..')
const SCRAPING_DIR = path.join(ROOT, 'data', 'scraping')
const LOG_FILE = path.join(SCRAPING_DIR, 'refresh_job.log')
const STATUS_FILE = path.join(SCRAPING_DIR, 'refresh_job.json')

export type RefreshJobStatus = 'idle' | 'running' | 'success' | 'failed'

export type RefreshJobState = {
  status: RefreshJobStatus
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  error: string | null
  logTail: string
}

let child: ChildProcess | null = null

function pythonCommand(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

function ensureScrapingDir() {
  fs.mkdirSync(SCRAPING_DIR, { recursive: true })
}

function readState(): RefreshJobState {
  ensureScrapingDir()
  if (fs.existsSync(STATUS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')) as RefreshJobState
    } catch {
      /* fall through */
    }
  }
  return {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    error: null,
    logTail: '',
  }
}

function writeState(state: RefreshJobState) {
  ensureScrapingDir()
  fs.writeFileSync(STATUS_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function appendLog(chunk: string) {
  ensureScrapingDir()
  fs.appendFileSync(LOG_FILE, chunk, 'utf8')
}

function tailLog(maxChars = 12000): string {
  if (!fs.existsSync(LOG_FILE)) return ''
  const raw = fs.readFileSync(LOG_FILE, 'utf8')
  return raw.length > maxChars ? raw.slice(-maxChars) : raw
}

export function getRefreshJobState(): RefreshJobState {
  const state = readState()
  state.logTail = tailLog()
  return state
}

export function isRefreshRunning(): boolean {
  return child !== null || readState().status === 'running'
}

function finishJob(exitCode: number, error: string | null) {
  const prev = readState()
  writeState({
    ...prev,
    status: exitCode === 0 ? 'success' : 'failed',
    finishedAt: new Date().toISOString(),
    exitCode,
    error,
    logTail: tailLog(),
  })
  child = null
}

export function startRefreshJob(cookie: string): { ok: boolean; error?: string } {
  const trimmed = cookie.trim()
  if (!trimmed) return { ok: false, error: 'cookie_required' }
  if (isRefreshRunning()) return { ok: false, error: 'job_already_running' }

  ensureScrapingDir()
  fs.writeFileSync(LOG_FILE, '', 'utf8')
  writeState({
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
    logTail: '',
  })

  const script = path.join(ROOT, 'scripts', 'refresh_anjuke_listings.py')
  child = spawn(pythonCommand(), [script, '--cookie', trimmed], {
    cwd: ROOT,
    env: { ...process.env, ANJUKE_COOKIE: trimmed, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const proc = child
  proc.stdout?.on('data', (buf: Buffer) => appendLog(buf.toString('utf8')))
  proc.stderr?.on('data', (buf: Buffer) => appendLog(buf.toString('utf8')))
  proc.on('error', (err) => {
    appendLog(`\n[spawn error] ${err.message}\n`)
    finishJob(1, err.message)
  })
  proc.on('close', (code) => {
    finishJob(code ?? 1, code === 0 ? null : 'refresh_script_failed')
  })

  return { ok: true }
}

export function testAnjukeCookie(cookie: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = cookie.trim()
  if (!trimmed) return Promise.resolve({ ok: false, message: 'Paste your Anjuke cookie first.' })

  return new Promise((resolve) => {
    const script = path.join(ROOT, 'scripts', 'refresh_anjuke_listings.py')
    const proc = spawn(pythonCommand(), [script, '--cookie', trimmed, '--test-cookie-only'], {
      cwd: ROOT,
      env: { ...process.env, ANJUKE_COOKIE: trimmed, PYTHONUNBUFFERED: '1' },
    })
    let out = ''
    proc.stdout.on('data', (buf: Buffer) => {
      out += buf.toString('utf8')
    })
    proc.stderr.on('data', (buf: Buffer) => {
      out += buf.toString('utf8')
    })
    proc.on('close', (code) => {
      resolve({
        ok: code === 0,
        message: out.trim() || (code === 0 ? 'Cookie OK' : 'Cookie test failed'),
      })
    })
    proc.on('error', (err) => {
      resolve({ ok: false, message: err.message })
    })
  })
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

export async function handleAnjukeRefreshRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<void> {
  if (pathname === '/api/dev/anjuke-refresh/status' && req.method === 'GET') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(getRefreshJobState()))
    return
  }

  if (pathname === '/api/dev/anjuke-refresh/test' && req.method === 'POST') {
    try {
      const body = (await readJsonBody(req)) as { cookie?: string }
      const result = await testAnjukeCookie(body.cookie ?? '')
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(result))
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, message: 'invalid_json' }))
    }
    return
  }

  if (pathname === '/api/dev/anjuke-refresh' && req.method === 'POST') {
    try {
      const body = (await readJsonBody(req)) as { cookie?: string }
      const result = startRefreshJob(body.cookie ?? '')
      res.statusCode = result.ok ? 202 : 409
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(result.ok ? { started: true } : result))
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: 'invalid_json' }))
    }
    return
  }

  res.statusCode = 404
  res.end()
}

function mountAnjukeRefreshApi(server: { middlewares: Connect.Server }) {
  // Path-prefix mount runs before Vite's SPA fallback (which would return index.html).
  server.middlewares.use('/api/dev/anjuke-refresh', (req, res) => {
    const suffix = req.url?.split('?')[0] ?? ''
    const pathname =
      suffix === '/' || suffix === ''
        ? '/api/dev/anjuke-refresh'
        : `/api/dev/anjuke-refresh${suffix}`
    void handleAnjukeRefreshRequest(req, res, pathname)
  })
}

export function anjukeRefreshApiPlugin() {
  return {
    name: 'guamap-anjuke-refresh-api',
    enforce: 'pre' as const,
    configureServer(server: { middlewares: Connect.Server }) {
      mountAnjukeRefreshApi(server)
    },
    configurePreviewServer(server: { middlewares: Connect.Server }) {
      mountAnjukeRefreshApi(server)
    },
  }
}
