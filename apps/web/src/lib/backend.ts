import { getAccessToken } from './authToken'

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

export async function backendFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
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
