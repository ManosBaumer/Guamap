import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/lib/store'

export default function LoginModal() {
  const authModalOpen = useStore((s) => s.authModalOpen)
  const setAuthModalOpen = useStore((s) => s.setAuthModalOpen)
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  if (!authModalOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        })
        if (error) throw error
        // Note: without email confirmation turned off, users must verify email. 
        // For local development or simplified usage, turn off email confirmation in Supabase Auth settings.
        alert('Registration successful! You are now logged in.')
        setAuthModalOpen(false)
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
        setAuthModalOpen(false)
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-sm rounded-[24px] p-6 relative shadow-2xl">
        <button
          onClick={() => setAuthModalOpen(false)}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        <h2 className="text-2xl font-bold text-[var(--color-text)] mb-6 text-center">
          {isRegister ? 'Create Account' : 'Welcome Back'}
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-shadow"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-shadow"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[var(--color-text)] text-white rounded-xl font-medium hover:bg-black/80 transition-colors flex justify-center items-center gap-2 mt-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : isRegister ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-[var(--color-primary)] font-medium hover:underline"
          >
            {isRegister ? 'Sign In' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  )
}
