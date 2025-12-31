'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { backendFetch, backendFetchBlob } from '@/lib/backend'
import { FileUploader } from '@/components/FileUploader'
import { SummaryRenderer } from '@/components/SummaryRenderer'
// Highlighter lives at /dashboard/highlighter
import { clearAccessToken, getAccessToken } from '@/lib/authToken'

type UploadedFile = {
  id: string
  file_name: string
  original_file_name: string
  file_size_bytes: number
  mime_type: string
  file_type: 'pdf' | 'image' | 'unknown'
  category: string | null
  processing_status: 'pending' | 'processing' | 'completed' | 'failed'
  extraction_error?: string | null
  created_at: string
  updated_at: string
}

type ListFilesResponse = { files: UploadedFile[] }
type ExtractedTextResponse = { text: string }
type SummaryResponse = { summary: string; provider?: string }
type SummaryLength = 'short' | 'medium' | 'long'


export default function FilesDashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [text, setText] = useState<string>('')
  const [textLoading, setTextLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [summaryFocus, setSummaryFocus] = useState('')
  const [summaryLength, setSummaryLength] = useState<SummaryLength>('medium')
  const [viewerUrl, setViewerUrl] = useState<string>('')
  const [viewerName, setViewerName] = useState<string>('')
  const [viewerLoading, setViewerLoading] = useState(false)
  const [viewerError, setViewerError] = useState<string | null>(null)

  const selected = useMemo(() => files.find((f) => f.id === selectedId) || null, [files, selectedId])

  useEffect(() => {
    setSummary(null)
    setSummaryError(null)
    setSummaryFocus('')
    setSummaryLength('medium')
    setViewerError(null)
  }, [selectedId])

  useEffect(() => {
    return () => {
      if (viewerUrl) URL.revokeObjectURL(viewerUrl)
    }
  }, [viewerUrl])

  async function loadFiles() {
    setError(null)
    const res = await backendFetch<ListFilesResponse>('/api/files', { method: 'GET' })
    setFiles(res.files || [])
  }

  async function loadText(fileId: string) {
    setTextLoading(true)
    setText('')
    try {
      const res = await backendFetch<ExtractedTextResponse>(`/api/files/${fileId}/text`, { method: 'GET' })
      setText(res.text || '')
      setSummary(null)
      setSummaryError(null)
      setSummaryFocus('')
    } finally {
      setTextLoading(false)
    }
  }

  async function generateSummary(fileId: string) {
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const payload = JSON.stringify({
        file_id: fileId,
        focus: summaryFocus.trim() || undefined,
        length: summaryLength,
      })
      const res = await backendFetch<SummaryResponse>('/api/summaries', {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json' },
      })
      setSummary(res.summary)
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Summarization failed')
    } finally {
      setSummaryLoading(false)
    }
  }

  async function viewFile(file: UploadedFile) {
    setViewerLoading(true)
    setViewerError(null)
    setSelectedId(file.id)
    setText('')
    setSummary(null)
    setSummaryError(null)
    setSummaryFocus('')
    setViewerName(file.original_file_name)

    try {
      const blob = await backendFetchBlob(`/api/files/${file.id}/content`, { method: 'GET' })
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
    setViewerName('')
    setViewerError(null)
  }

  async function del(fileId: string) {
    if (!confirm('Delete this file? This removes the stored file and extracted text.')) return
    await backendFetch(`/api/files/${fileId}`, { method: 'DELETE' })
    setSelectedId((cur) => (cur === fileId ? null : cur))
    setText('')
    setSummary(null)
    setSummaryError(null)
    setSummaryFocus('')
    await loadFiles()
  }

  async function signOut() {
    clearAccessToken()
    router.replace('/login')
  }

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        if (!getAccessToken()) {
          router.replace('/login')
          return
        }
        await loadFiles()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [router])

  // Lightweight polling while there are pending/processing files
  useEffect(() => {
    const hasRunning = files.some((f) => f.processing_status === 'pending' || f.processing_status === 'processing')
    if (!hasRunning) return
    const t = setInterval(() => {
      loadFiles().catch(() => {})
    }, 2500)
    return () => clearInterval(t)
  }, [files])

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Uploads</h1>
            <p className="text-sm text-zinc-600">Upload notes → extract text → view → delete.</p>
          </div>
          <button className="rounded-xl border bg-white px-4 py-2 text-sm" onClick={signOut}>
            Sign out
          </button>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border bg-white p-5">
            <h2 className="text-base font-semibold">Upload notes</h2>
            <p className="mt-1 text-sm text-zinc-600">PDFs and images supported.</p>
            <div className="mt-4">
              <FileUploader onUploaded={loadFiles} />
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-5">
            <h2 className="text-base font-semibold">Viewer & extracted text</h2>
            <p className="mt-1 text-sm text-zinc-600">View the original document and its extracted text.</p>
            <div className="mt-4">
              {selected ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{selected.original_file_name}</div>
                      <div className="text-xs text-zinc-500">Status: {selected.processing_status}</div>
                    </div>
                    <button
                      className="shrink-0 rounded-xl border px-3 py-1.5 text-xs"
                      onClick={() => loadText(selected.id)}
                      disabled={textLoading || selected.processing_status !== 'completed'}
                    >
                      {textLoading ? 'Loading…' : 'Load text'}
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">Document viewer</div>
                      {viewerUrl ? (
                        <button className="rounded-lg border px-3 py-1.5 text-xs" onClick={closeViewer}>
                          Close
                        </button>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-zinc-500">Highlighter moved to its own page.</div>
                      {selectedId ? (
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-lg border bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
                            onClick={() => router.push(`/dashboard/highlighter?fileId=${selectedId}`)}
                          >
                            Open highlighter
                          </button>
                          <button
                            className="rounded-lg border bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800"
                            onClick={() => router.push(`/dashboard/quiz?fileId=${selectedId}`)}
                          >
                            Quiz generator
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {viewerError ? <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{viewerError}</div> : null}
                    {viewerLoading ? (
                      <div className="rounded-xl border border-dashed p-6 text-sm text-zinc-500">Loading document…</div>
                    ) : viewerUrl ? (
                      <div className="overflow-hidden rounded-xl border bg-white">
                        <div className="border-b px-3 py-2 text-xs text-zinc-600">{viewerName || 'Document'}</div>
                        <iframe className="h-[70vh] w-full" src={viewerUrl} title={viewerName || 'Document viewer'} />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed p-6 text-sm text-zinc-500">
                        Click “View” on a file to open it here.
                      </div>
                    )}
                  </div>

                  <textarea
                    className="h-64 w-full rounded-xl border p-3 font-mono text-xs"
                    readOnly
                    value={textLoading ? 'Loading…' : selected.processing_status !== 'completed' ? 'Not ready yet.' : text}
                  />

                  <div className="space-y-2 pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">Summarize</h3>
                      <p className="text-xs text-zinc-500">Let your local LLM distill the key points.</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr,auto]">
                      <input
                        className="rounded-xl border px-3 py-2 text-sm"
                        placeholder="Focus on, e.g., exam steps or therapy plans (optional)"
                        value={summaryFocus}
                        onChange={(event) => setSummaryFocus(event.target.value)}
                        disabled={summaryLoading}
                      />
                      <div className="flex items-center justify-end gap-2">
                        <select
                          className="rounded-xl border bg-white px-3 py-2 text-xs"
                          value={summaryLength}
                          onChange={(event) => setSummaryLength(event.target.value as any)}
                          disabled={summaryLoading}
                        >
                          <option value="short">Short</option>
                          <option value="medium">Medium</option>
                          <option value="long">Long</option>
                        </select>
                      <button
                        className="rounded-xl border bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700"
                        onClick={() => (selected ? generateSummary(selected.id) : undefined)}
                        disabled={summaryLoading || selected.processing_status !== 'completed'}
                      >
                        {summaryLoading ? 'Summarizing…' : 'Generate summary'}
                      </button>
                      </div>
                    </div>
                    {summaryError ? (
                      <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{summaryError}</div>
                    ) : null}
                    {summary ? (
                      <div className="rounded-2xl border border-dashed bg-zinc-100 p-4 text-sm text-zinc-800">
                        <SummaryRenderer text={summary} />
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500">Summaries stay cached until you look at another file.</p>
                    )}
                  </div>

                  {selected.extraction_error ? (
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{selected.extraction_error}</div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-6 text-sm text-zinc-500">No file selected.</div>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Your files</h2>
            <button className="rounded-xl border px-3 py-1.5 text-sm" onClick={loadFiles}>
              Refresh
            </button>
          </div>

          {error ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-2">Name</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="py-3 text-zinc-600" colSpan={4}>
                      Loading…
                    </td>
                  </tr>
                ) : files.length ? (
                  files.map((f) => (
                    <tr key={f.id} className="border-t">
                      <td className="py-3">
                        <button
                          className="max-w-[420px] truncate text-left font-medium hover:underline"
                          onClick={() => {
                            setSelectedId(f.id)
                            setText('')
                          }}
                        >
                          {f.original_file_name}
                        </button>
                      </td>
                      <td className="py-3 text-zinc-600">{f.file_type}</td>
                      <td className="py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${
                            f.processing_status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : f.processing_status === 'failed'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {f.processing_status}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            className="rounded-lg border px-3 py-1.5 text-xs"
                            onClick={() => viewFile(f)}
                          >
                            View
                          </button>
                          <button className="rounded-lg border px-3 py-1.5 text-xs" onClick={() => del(f.id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-3 text-zinc-600" colSpan={4}>
                      No uploads yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
