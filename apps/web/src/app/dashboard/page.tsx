'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { backendFetch } from '@/lib/backend'
import { getAccessToken } from '@/lib/authToken'

type ChatResponse = { answer: string; provider?: string }
type Msg = { role: 'user' | 'assistant'; content: string }

function IconPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconMic({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M19 11a7 7 0 0 1-14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 11.5 21 3l-8.5 18-2.2-7.2L3 11.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconCopy({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9 9h10v10H9V9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M5 15V5h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconThumb({ className, up }: { className?: string; up: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d={
          up
            ? 'M7 10v10H4V10h3Zm3 10h8a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-5l1-4.5a2 2 0 0 0-2-2L10 10Z'
            : 'M7 14V4H4v10h3Zm3-10h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-5l1 4.5a2 2 0 0 1-2 2L10 14Z'
        }
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function DashboardHomePage() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<'default' | 'ollama' | 'openai' | 'gemini'>('default')
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!getAccessToken()) router.replace('/login')
  }, [router])

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [msgs, loading])

  async function sendMessage(next?: string) {
    const message = (typeof next === 'string' ? next : input).trim()
    if (!message || loading) return

    setError(null)
    setLoading(true)
    setInput('')
    setMsgs((m) => [...m, { role: 'user', content: message }])

    try {
      const body: any = { message }
      if (provider && provider !== 'default') body.provider = provider
      const res = await backendFetch<ChatResponse>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer || '' }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-900 text-zinc-100">
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto px-6 py-10">
        <div className="mx-auto max-w-3xl space-y-8">
          {msgs.length === 0 ? (
            <div className="pt-12 text-center">
              <div className="text-4xl font-semibold tracking-tight">Study Buddy</div>
              <div className="mx-auto mt-3 max-w-xl text-sm text-zinc-400">Ask anything about your studies.</div>
            </div>
          ) : null}

          {msgs.map((m, idx) => {
            if (m.role === 'user') {
              return (
                <div key={idx} className="flex justify-end">
                  <div className="max-w-[70%] rounded-2xl bg-zinc-800 px-4 py-2 text-sm text-zinc-50">{m.content}</div>
                </div>
              )
            }

            return (
              <div key={idx} className="space-y-3">
                <div className="text-base leading-relaxed text-zinc-100">{m.content}</div>
                <div className="flex items-center gap-3 text-zinc-400">
                  <button
                    type="button"
                    className="rounded-md p-1 hover:bg-zinc-800"
                    title="Copy"
                    aria-label="Copy"
                    onClick={() => navigator.clipboard?.writeText(m.content).catch(() => {})}
                  >
                    <IconCopy className="h-5 w-5" />
                  </button>
                  <button type="button" className="rounded-md p-1 hover:bg-zinc-800" title="Good" aria-label="Good">
                    <IconThumb up className="h-5 w-5" />
                  </button>
                  <button type="button" className="rounded-md p-1 hover:bg-zinc-800" title="Bad" aria-label="Bad">
                    <IconThumb up={false} className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )
          })}

          {loading ? <div className="text-sm text-zinc-400">Thinking…</div> : null}
        </div>
      </div>

      <div className="border-t border-zinc-800 bg-zinc-900/90 backdrop-blur">
        <div className="mx-auto max-w-3xl px-6 py-4">
          {error ? <div className="mb-2 text-xs text-red-300">{error}</div> : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-zinc-200"
              title="New"
              aria-label="New"
              onClick={() => setMsgs([])}
            >
              <IconPlus className="h-5 w-5" />
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-3">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as any)}
                className="h-6 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
                title="Provider"
                aria-label="Provider"
              >
                <option value="default">auto</option>
                <option value="ollama">ollama</option>
                <option value="openai">openai</option>
                <option value="gemini">gemini</option>
              </select>

              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder="Ask anything"
                className="h-6 min-w-0 flex-1 bg-transparent text-sm text-zinc-50 placeholder:text-zinc-400 focus:outline-none"
              />

              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-700"
                title="Voice (not enabled)"
                aria-label="Voice"
                disabled
              >
                <IconMic className="h-5 w-5" />
              </button>

              <button
                type="button"
                className={
                  'flex h-9 w-9 items-center justify-center rounded-full ' +
                  (canSend ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-zinc-700 text-zinc-400')
                }
                title="Send"
                aria-label="Send"
                onClick={() => sendMessage()}
                disabled={!canSend}
              >
                <IconSend className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mt-2 text-center text-[11px] text-zinc-500">Study Buddy can make mistakes. Check important info.</div>
        </div>
      </div>
    </div>
  )
}
