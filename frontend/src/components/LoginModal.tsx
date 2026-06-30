import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/lib/store'
import PasswordInput from '@/components/PasswordInput'

type AuthView = 'login' | 'register' | 'forgot' | 'reset'

function authRedirectUrl(): string {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  return `${window.location.origin}${base}`
}

export default function LoginModal() {
  const authModalOpen = useStore((s) => s.authModalOpen)
  const setAuthModalOpen = useStore((s) => s.setAuthModalOpen)

  const [view, setView] = useState<AuthView>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setView('reset')
        setAuthModalOpen(true)
        setError(null)
        setInfo(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [setAuthModalOpen])

  useEffect(() => {
    if (!authModalOpen) {
      setView('login')
      setError(null)
      setInfo(null)
      setPassword('')
      setConfirmPassword('')
    }
  }, [authModalOpen])

  if (!authModalOpen) return null

  const clearMessages = () => {
    setError(null)
    setInfo(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearMessages()
    setLoading(true)

    try {
      if (view === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectUrl(),
        })
        if (error) throw error
        setInfo('If an account exists for that email, we sent a password reset link.')
        return
      }

      if (view === 'reset') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match')
        }
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setInfo('Password updated. You are now signed in.')
        setPassword('')
        setConfirmPassword('')
        window.setTimeout(() => setAuthModalOpen(false), 1200)
        return
      }

      if (view === 'register') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setInfo('Registration successful! You are now logged in.')
        window.setTimeout(() => setAuthModalOpen(false), 1200)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setAuthModalOpen(false)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const title =
    view === 'register'
      ? 'Create Account'
      : view === 'forgot'
        ? 'Reset password'
        : view === 'reset'
          ? 'Choose new password'
          : 'Welcome Back'

  const submitLabel =
    view === 'register'
      ? 'Sign Up'
      : view === 'forgot'
        ? 'Send reset link'
        : view === 'reset'
          ? 'Update password'
          : 'Sign In'

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-sm rounded-[24px] p-6 relative shadow-2xl">
        <button
          type="button"
          onClick={() => setAuthModalOpen(false)}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        <h2 className="text-2xl font-bold text-[var(--color-text)] mb-6 text-center">{title}</h2>

        {view === 'forgot' && (
          <p className="mb-4 text-sm text-gray-500 text-center leading-snug">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>
        )}
        {info && (
          <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-xl text-sm">{info}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {view !== 'reset' && (
            <div>
              <label htmlFor="auth-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-shadow"
                required
              />
            </div>
          )}

          {view !== 'forgot' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="auth-password" className="block text-sm font-medium text-gray-700">
                  {view === 'reset' ? 'New password' : 'Password'}
                </label>
                {view === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      clearMessages()
                      setView('forgot')
                    }}
                    className="text-xs text-[var(--color-primary)] font-medium hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <PasswordInput
                id="auth-password"
                value={password}
                onChange={setPassword}
                autoComplete={view === 'register' || view === 'reset' ? 'new-password' : 'current-password'}
                required
                minLength={6}
              />
            </div>
          )}

          {view === 'reset' && (
            <div>
              <label htmlFor="auth-confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm password
              </label>
              <PasswordInput
                id="auth-confirm-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                required
                minLength={6}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (view === 'forgot' && !!info)}
            className="w-full py-3 bg-[var(--color-text)] text-white rounded-xl font-medium hover:bg-black/80 transition-colors flex justify-center items-center gap-2 mt-2 disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : submitLabel}
          </button>
        </form>

        {view === 'login' && (
          <p className="mt-6 text-center text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <button
              type="button"
              onClick={() => {
                clearMessages()
                setView('register')
              }}
              className="text-[var(--color-primary)] font-medium hover:underline cursor-pointer"
            >
              Create one
            </button>
          </p>
        )}

        {view === 'register' && (
          <p className="mt-6 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => {
                clearMessages()
                setView('login')
              }}
              className="text-[var(--color-primary)] font-medium hover:underline cursor-pointer"
            >
              Sign In
            </button>
          </p>
        )}

        {(view === 'forgot' || view === 'reset') && (
          <p className="mt-6 text-center text-sm text-gray-500">
            <button
              type="button"
              onClick={() => {
                clearMessages()
                setView('login')
              }}
              className="text-[var(--color-primary)] font-medium hover:underline cursor-pointer"
            >
              Back to sign in
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
