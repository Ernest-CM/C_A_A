'use client'

import { useEffect, useMemo, useState } from 'react'

import { backendFetch, backendFetchBlob } from '@/lib/backend'
import { SummaryRenderer } from '@/components/SummaryRenderer'
import { getAccessToken } from '@/lib/authToken'

type HealthResponse = {
  status: string
  ollama?: {
    url?: string | null
    model?: string | null
    reachable?: boolean
  }
}

type UploadedFile = {
  id: string
  original_file_name: string
  file_type: 'pdf' | 'image' | 'unknown'
  processing_status: 'pending' | 'processing' | 'completed' | 'failed'
  extraction_error?: string | null
  created_at: string
}

type ListFilesResponse = { files: UploadedFile[] }

type SummaryResponse = {
  file_id: string
  summary: string
  provider?: string
}

type SummaryLength = 'short' | 'medium' | 'long'

export default function LabPage() {
  const backendUrl = useMemo(() => process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000', [])

  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)

  const [files, setFiles] = useState<UploadedFile[]>([])
  const [filesError, setFilesError] = useState<string | null>(null)
  const [filesLoading, setFilesLoading] = useState(false)

  const [selectedId, setSelectedId] = useState<string>('')
  const [focus, setFocus] = useState<string>('')
  const [summaryLength, setSummaryLength] = useState<SummaryLength>('medium')
  const [viewerUrl, setViewerUrl] = useState<string>('')
  const [viewerLoading, setViewerLoading] = useState(false)
  const [viewerError, setViewerError] = useState<string | null>(null)

  const [summary, setSummary] = useState<string>('')
  const [provider, setProvider] = useState<string>('')
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const authed = !!getAccessToken()

  async function loadHealth() {
    setHealthError(null)
    try {
      const res = await fetch(`${backendUrl}/health`, { method: 'GET' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Health failed: ${res.status}`)
      }
      setHealth((await res.json()) as HealthResponse)
    } catch (e) {
      setHealth(null)
      setHealthError(e instanceof Error ? e.message : 'Health failed')
    }
  }

  async function loadFiles() {
    setFilesLoading(true)
    setFilesError(null)
    try {
      const res = await backendFetch<ListFilesResponse>('/api/files', { method: 'GET' })
      const list = res.files || []
      setFiles(list)
      if (!selectedId && list.length) setSelectedId(list[0].id)
    } catch (e) {
      setFiles([])
      setFilesError(e instanceof Error ? e.message : 'Failed to load files')
    } finally {
      setFilesLoading(false)
    }
  }

  async function generateSummary() {
    if (!selectedId) {
      setSummaryError('Select a file first')
      return
    }
    setSummaryLoading(true)
    setSummaryError(null)
    setSummary('')
    setProvider('')
    try {
      const body = JSON.stringify({ file_id: selectedId, focus: focus.trim() || undefined })
      const bodyWithLength = JSON.stringify({ file_id: selectedId, focus: focus.trim() || undefined, length: summaryLength })
      const res = await backendFetch<SummaryResponse>('/api/summaries', {
        method: 'POST',
        body: bodyWithLength,
        headers: { 'Content-Type': 'application/json' },
      })
      setSummary(res.summary || '')
      setProvider(res.provider || '')
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Summarization failed')
    } finally {
      setSummaryLoading(false)
    }
  }

  async function viewFile(fileId: string) {
    setViewerLoading(true)
    setViewerError(null)
    try {
      const blob = await backendFetchBlob(`/api/files/${fileId}/content`, { method: 'GET' })
      const nextUrl = URL.createObjectURL(blob)
      setViewerUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return nextUrl
      })
    } catch (err) {
      setViewerError(err instanceof Error ? err.message : 'Failed to load document')
    } finally {
      setViewerLoading(false)
    }
  }

  function closeViewer() {
    setViewerUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return ''
    })
    setViewerError(null)
  }

  useEffect(() => {
    return () => {
      if (viewerUrl) URL.revokeObjectURL(viewerUrl)
    }
  }, [viewerUrl])

  useEffect(() => {
    loadHealth().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!authed) return
    loadFiles().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  const selected = files.find((f) => f.id === selectedId) || null

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Testing Lab</h1>
            <p className="text-sm text-zinc-600">Confirm backend, uploads, extraction, and local summarization.</p>
          </div>
          <button
            className="rounded-xl border bg-white px-4 py-2 text-sm"
            onClick={() => {
              loadHealth().catch(() => {})
              if (authed) loadFiles().catch(() => {})
            }}
          >
            Refresh
          </button>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5">
            <h2 className="text-base font-semibold">Backend</h2>
            <p className="mt-1 text-sm text-zinc-600">Quick health + Ollama detect.</p>

            {health ? (
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600">Status</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{health.status}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-600">Ollama model</span>
                  <span className="font-mono text-xs">{health.ollama?.model || '—'}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-600">Ollama reachable</span>
                  <span className="text-xs">{health.ollama?.reachable ? 'Yes' : 'No'}</span>
                </div>

                <div className="pt-2 text-xs text-zinc-500">
                  Backend URL: <span className="font-mono">{backendUrl}</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-zinc-700">{healthError ? healthError : 'Loading…'}</div>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <h2 className="text-base font-semibold">Auth</h2>
            <p className="mt-1 text-sm text-zinc-600">Uses the JWT you got from login.</p>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">JWT present</span>
                <span className={`rounded-full px-2 py-1 text-xs ${authed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                  {authed ? 'Yes' : 'No'}
                </span>
              </div>
              {!authed ? (
                <div className="text-xs text-zinc-500">Go to /login, sign in, then come back.</div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Summarizer test</h2>
              <p className="mt-1 text-sm text-zinc-600">Pick a completed upload and generate a summary.</p>
            </div>
            <button className="rounded-xl border px-3 py-1.5 text-sm" onClick={loadFiles} disabled={!authed || filesLoading}>
              {filesLoading ? 'Loading…' : 'Reload files'}
            </button>
          </div>

          {filesError ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{filesError}</div> : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border p-4">
              <div className="text-xs text-zinc-500">File</div>
              <select
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value)
                  setSummary('')
                  setProvider('')
                  setSummaryError(null)
                }}
                disabled={!authed || !files.length}
              >
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.original_file_name} ({f.processing_status})
                  </option>
                ))}
              </select>

              {selected ? (
                <div className="mt-3 text-xs text-zinc-600">
                  Status: <span className="font-medium">{selected.processing_status}</span>
                  {selected.extraction_error ? <div className="mt-2 text-red-700">{selected.extraction_error}</div> : null}
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-xs text-zinc-500">Focus (optional)</div>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="e.g., exam steps, definitions, likely questions"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                disabled={!authed || summaryLoading}
              />

              <div className="mt-3 flex items-center gap-2">
                <select
                  className="rounded-xl border bg-white px-3 py-2 text-xs"
                  value={summaryLength}
                  onChange={(e) => setSummaryLength(e.target.value as SummaryLength)}
                  disabled={!authed || summaryLoading}
                >
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long</option>
                </select>

                <button
                  className="rounded-xl border px-4 py-2 text-xs disabled:opacity-50"
                  onClick={() => viewFile(selectedId)}
                  disabled={!authed || !selectedId}
                >
                  View in page
                </button>

                <button
                  className="rounded-xl border bg-zinc-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  onClick={generateSummary}
                  disabled={!authed || !selectedId || summaryLoading || selected?.processing_status !== 'completed'}
                >
                  {summaryLoading ? 'Summarizing…' : 'Generate summary'}
                </button>

                {provider ? (
                  <span className="rounded-full bg-violet-50 px-3 py-2 text-xs text-violet-700">Used: {provider}</span>
                ) : null}
              </div>

              {summaryError ? <div className="mt-3 text-xs text-red-700">{summaryError}</div> : null}
            </div>

            <div className="mt-4 rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-zinc-700">Document viewer</div>
                {viewerUrl ? (
                  <button className="rounded-xl border px-3 py-1.5 text-xs" onClick={closeViewer}>
                    Close
                  </button>
                ) : null}
              </div>

              {viewerError ? <div className="mt-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">{viewerError}</div> : null}

              {viewerLoading ? (
                <div className="mt-2 rounded-xl border border-dashed p-6 text-sm text-zinc-500">Loading document…</div>
              ) : viewerUrl ? (
                <div className="mt-2 overflow-hidden rounded-xl border bg-white">
                  <iframe className="h-[70vh] w-full" src={viewerUrl} title="Document viewer" />
                </div>
              ) : (
                <div className="mt-2 rounded-xl border border-dashed p-6 text-sm text-zinc-500">
                  Click “View in page” to open the file here.
                </div>
              )}
            </div>
          </div>

          {summary ? (
            <div className="mt-4 rounded-2xl border border-dashed bg-zinc-50 p-4">
              <div className="text-xs text-zinc-500">Summary</div>
              <div className="mt-2">
                <SummaryRenderer text={summary} />
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-base font-semibold">Pass criteria</h2>
          <div className="mt-2 text-sm text-zinc-700">
            <ul className="list-disc pl-5">
              <li>Backend status is ok</li>
              <li>Ollama reachable is Yes</li>
              <li>You can list files</li>
              <li>You can generate a summary and see Used: ollama</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  )
}
