'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { setAccessToken } from '@/lib/authToken'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

  async function submit() {
    setLoading(true)
    setError(null)
    try {
      const endpoint = mode === 'signin' ? '/api/auth/login' : '/api/auth/signup'
      const res = await fetch(`${backendUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Login failed')
      }
      const data = (await res.json()) as { access_token: string }
      if (!data.access_token) throw new Error('Missing token')

      setAccessToken(data.access_token)
      router.replace('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-900 p-6 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-2xl font-semibold">Departmental Study Buddy</h1>
        <p className="mt-1 text-sm text-zinc-400">Sign in to upload notes and extract text.</p>

        <div className="mt-6 space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder:text-zinc-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@school.edu"
              autoComplete="email"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder:text-zinc-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>

          {error ? <div className="rounded-lg border border-red-900/40 bg-red-950/40 p-3 text-sm text-red-200">{error}</div> : null}

          <button
            className="w-full rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
            disabled={loading || !email || !password}
            onClick={submit}
          >
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          <button
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-100"
            disabled={loading}
            onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
          >
            {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
