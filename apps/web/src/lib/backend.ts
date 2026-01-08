import { getAccessToken } from './authToken'

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

type LLMProvider = 'ollama' | 'openai' | 'gemini'

const GLOBAL_LLM_PROVIDER_STORAGE_KEY = 'caa.global_llm_provider'

export function getGlobalLLMProvider(): LLMProvider | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(GLOBAL_LLM_PROVIDER_STORAGE_KEY)
    if (raw === 'ollama' || raw === 'openai' || raw === 'gemini') return raw
    return null
  } catch {
    return null
  }
}

export function setGlobalLLMProvider(provider: LLMProvider | null): void {
  if (typeof window === 'undefined') return
  try {
    if (!provider) {
      window.localStorage.removeItem(GLOBAL_LLM_PROVIDER_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(GLOBAL_LLM_PROVIDER_STORAGE_KEY, provider)
  } catch {
    // ignore storage failures
  }
}

function shouldInjectProvider(path: string): boolean {
  // Only endpoints that support optional `provider`.
  return (
    path === '/api/chat' ||
    path === '/api/summaries' ||
    path === '/api/quizzes' ||
    path === '/api/quizzes/grade' ||
    path === '/api/flashcards' ||
    path === '/api/mindmaps' ||
    path === '/api/mindmaps/summary'
  )
}

function tryInjectProvider(path: string, init: RequestInit): RequestInit {
  if (!shouldInjectProvider(path)) return init

  const method = (init.method || 'GET').toUpperCase()
  if (method !== 'POST') return init

  const provider = getGlobalLLMProvider()
  if (!provider) return init

  const headers = new Headers(init.headers)
  const contentType = headers.get('Content-Type') || headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) return init

  if (typeof init.body !== 'string' || !init.body) return init

  try {
    const parsed = JSON.parse(init.body) as any
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return init
    if (parsed.provider) return init
    parsed.provider = provider
    return {
      ...init,
      headers,
      body: JSON.stringify(parsed),
    }
  } catch {
    return init
  }
}

export async function backendFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken()
  if (!token) throw new Error('Not authenticated')
  const nextInit = tryInjectProvider(path, init)
  const headers = new Headers(nextInit.headers)
  headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${backendUrl}${path}`, {
    ...nextInit,
    headers,
  })

  if (!res.ok) {
    let msg = `Request failed: ${res.status}`
    try {
      const data = await res.json()
      msg = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data)
    } catch {
      const text = await res.text().catch(() => '')
      if (text) msg = text
    }
    throw new Error(msg)
  }

  const ct = res.headers.get('content-type')
  if (ct && ct.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as T
}

export async function backendFetchBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const token = getAccessToken()
  if (!token) throw new Error('Not authenticated')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers,
  })

  if (!res.ok) {
    let msg = `Request failed: ${res.status}`
    try {
      const data = await res.json()
      msg = typeof (data as any)?.detail === 'string' ? (data as any).detail : JSON.stringify(data)
    } catch {
      const text = await res.text().catch(() => '')
      if (text) msg = text
    }
    throw new Error(msg)
  }

  return await res.blob()
}
