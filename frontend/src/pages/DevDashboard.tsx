import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Cloud,
  ExternalLink,
  Lock,
  LogOut,
  Play,
  ShieldCheck,
  TestTube2,
  Wrench,
} from 'lucide-react'
import LoginModal from '@/components/LoginModal'
import { isDevAdmin } from '@/lib/devAccess'
import { navigateTo } from '@/hooks/usePathname'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/lib/store'

type RefreshJobState = {
  status: 'idle' | 'running' | 'success' | 'failed'
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  error: string | null
  logTail: string
}

const COOKIE_STORAGE_KEY = 'guamap-dev-anjuke-cookie'

export default function DevDashboard() {
  const user = useStore((s) => s.user)
  const setAuthModalOpen = useStore((s) => s.setAuthModalOpen)
  const allowed = isDevAdmin(user)

  const [cookie, setCookie] = useState(() => sessionStorage.getItem(COOKIE_STORAGE_KEY) ?? '')
  const [job, setJob] = useState<RefreshJobState | null>(null)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [testOk, setTestOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    document.body.style.overflow = 'auto'
    return () => {
      document.body.style.overflow = 'hidden'
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem(COOKIE_STORAGE_KEY, cookie)
  }, [cookie])

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/dev/anjuke-refresh/status')
      if (!res.ok) return
      const body = (await res.json()) as RefreshJobState
      setJob(body)
    } catch {
      /* ignore while dev server unavailable */
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    void pollStatus()
    const id = window.setInterval(() => void pollStatus(), 2000)
    return () => window.clearInterval(id)
  }, [allowed, pollStatus])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [job?.logTail])

  const runTest = async () => {
    setBusy(true)
    setTestMessage(null)
    setTestOk(null)
    try {
      const res = await fetch('/api/dev/anjuke-refresh/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie }),
      })
      const body = (await res.json()) as { ok: boolean; message: string }
      setTestOk(body.ok)
      setTestMessage(body.message)
    } catch (e) {
      setTestOk(false)
      setTestMessage(e instanceof Error ? e.message : 'Test failed')
    } finally {
      setBusy(false)
    }
  }

  const runRefresh = async () => {
    setBusy(true)
    setTestMessage(null)
    try {
      const res = await fetch('/api/dev/anjuke-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie }),
      })
      const body = (await res.json()) as { started?: boolean; error?: string }
      if (!res.ok) {
        setTestOk(false)
        setTestMessage(body.error ?? `HTTP ${res.status}`)
        return
      }
      await pollStatus()
    } catch (e) {
      setTestOk(false)
      setTestMessage(e instanceof Error ? e.message : 'Could not start refresh')
    } finally {
      setBusy(false)
    }
  }

  const gate = !user ? 'signin' : !allowed ? 'denied' : 'ok'

  return (
    <div className="min-h-screen bg-[var(--color-bg-card)] text-[var(--color-text)]">
      <LoginModal />

      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-white/95 backdrop-blur px-6 py-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigateTo('/')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          Back to map
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <Wrench className="w-4 h-4 text-gray-500" aria-hidden />
          <span className="text-sm font-semibold">Listing refresh</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {gate === 'signin' && (
          <section className="rounded-2xl border border-[var(--color-border)] bg-white p-8 text-center">
            <Lock className="w-10 h-10 mx-auto text-gray-400 mb-3" aria-hidden />
            <h1 className="text-xl font-semibold mb-2">Sign in required</h1>
            <p className="text-sm text-gray-500 mb-5">Developer tools are restricted to your account.</p>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[var(--color-text)] text-white text-sm font-medium cursor-pointer hover:bg-black/85"
            >
              Sign in
            </button>
          </section>
        )}

        {gate === 'denied' && (
          <section className="rounded-2xl border border-[var(--color-border)] bg-white p-8 text-center">
            <ShieldCheck className="w-10 h-10 mx-auto text-amber-500 mb-3" aria-hidden />
            <h1 className="text-xl font-semibold mb-2">Access denied</h1>
            <p className="text-sm text-gray-500 mb-5">Signed in as {user?.email}</p>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm font-medium cursor-pointer hover:bg-gray-50"
            >
              <LogOut className="w-4 h-4" aria-hidden />
              Sign out
            </button>
          </section>
        )}

        {gate === 'ok' && (
          <>
            <section>
              <h1 className="text-2xl font-semibold mb-1">Refresh communities & listings</h1>
              <p className="text-sm text-gray-500 leading-relaxed">
                Incremental Anjuke scrape → mark removed listings as sold → update{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">frontend/public/data</code>. No transit
                recalculation. Runs locally via the dev server (keep this tab open; can take 1–3 hours).
              </p>
            </section>

            <section className="rounded-2xl border border-[var(--color-border)] bg-white p-5 space-y-4">
              <div>
                <label htmlFor="anjuke-cookie" className="block text-sm font-semibold mb-1.5">
                  Anjuke cookie
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  From Chrome DevTools → Network → refresh gz.zu.anjuke.com → copy the request{' '}
                  <code className="bg-gray-100 px-1 rounded">cookie</code> header. Stored in this browser tab
                  only (sessionStorage).
                </p>
                <textarea
                  id="anjuke-cookie"
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  rows={4}
                  placeholder="Paste cookie string here…"
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-mono leading-relaxed resize-y"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !cookie.trim()}
                  onClick={() => void runTest()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm font-medium cursor-pointer hover:bg-gray-50 disabled:opacity-50"
                >
                  <TestTube2 className="w-4 h-4" aria-hidden />
                  Test cookie
                </button>
                <button
                  type="button"
                  disabled={busy || !cookie.trim() || job?.status === 'running'}
                  onClick={() => void runRefresh()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-text)] text-white text-sm font-medium cursor-pointer hover:bg-black/85 disabled:opacity-50"
                >
                  <Play className="w-4 h-4" aria-hidden />
                  Start refresh
                </button>
              </div>

              {testMessage && (
                <p
                  className={`text-sm rounded-lg px-3 py-2 ${
                    testOk ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                  }`}
                >
                  {testMessage}
                </p>
              )}

              {job && job.status !== 'idle' && (
                <div className="text-sm">
                  <span className="font-medium">Status:</span>{' '}
                  <span
                    className={
                      job.status === 'running'
                        ? 'text-amber-700'
                        : job.status === 'success'
                          ? 'text-emerald-700'
                          : 'text-red-700'
                    }
                  >
                    {job.status}
                  </span>
                  {job.error && <span className="text-red-600 ml-2">({job.error})</span>}
                </div>
              )}

              {job?.logTail && (
                <pre
                  ref={logRef}
                  className="text-[11px] leading-relaxed bg-gray-950 text-gray-100 rounded-lg p-3 max-h-80 overflow-auto whitespace-pre-wrap font-mono"
                >
                  {job.logTail}
                </pre>
              )}
            </section>

            <section className="rounded-2xl border border-[var(--color-border)] bg-white p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-gray-500" aria-hidden />
                <h2 className="text-sm font-semibold">Run overnight in the cloud (free)</h2>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                Use GitHub Actions: Actions → <strong>Refresh Anjuke listings</strong> → Run workflow.
                Paste your cookie, or set repository secret{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">ANJUKE_COOKIE</code>. Scrape progress
                is pushed to branch{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">anjuke-scrape-cache</code> every ~25
                communities. On failure/timeout it <strong>auto-retries</strong> after ~1 min (up to 20
                times). Updated{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">frontend/public/data</code> is committed
                to main when a run completes. Free tier: ~2,000 minutes/month.
              </p>
              <a
                href="https://github.com/ManosBaumer/Guamap/actions/workflows/refresh-anjuke.yml"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline"
              >
                Open GitHub Actions workflow
                <ExternalLink className="w-3.5 h-3.5" aria-hidden />
              </a>
              <p className="text-xs text-gray-500">
                Email alerts (start / success / crash): set SMTP vars in root{' '}
                <code className="bg-gray-100 px-1 rounded">.env</code> — see{' '}
                <code className="bg-gray-100 px-1 rounded">.env.example</code>.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
