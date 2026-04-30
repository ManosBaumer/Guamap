import { useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/lib/store'

type Mode = 'login' | 'register'

export default function AuthModal() {
  const { authModalOpen, setAuthModalOpen } = useStore()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!authModalOpen) return null

  function close() {
    setAuthModalOpen(false)
    setError(null)
    setInfo(null)
    setEmail('')
    setPassword('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)

    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setInfo('Check your email to confirm your account.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        close()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </h2>
          <button
            onClick={close}
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
          {info && (
            <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{info}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 text-sm transition-colors"
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          {mode === 'login' ? (
            <>
              No account?{' '}
              <button
                onClick={() => { setMode('register'); setError(null); setInfo(null) }}
                className="text-blue-600 hover:underline font-medium"
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => { setMode('login'); setError(null); setInfo(null) }}
                className="text-blue-600 hover:underline font-medium"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
