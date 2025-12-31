'use client'

import React from 'react'
import { useRouter } from 'next/navigation'

import { backendFetch, backendFetchBlob } from '@/lib/backend'
import { clearAccessToken, getAccessToken } from '@/lib/authToken'
import { PdfHighlighterViewer, type HighlightRule } from '@/components/PdfHighlighterViewer'
import { SummaryRenderer } from '@/components/SummaryRenderer'

type UploadedFile = {
  id: string
  original_file_name: string
  mime_type: string
  processing_status: 'pending' | 'processing' | 'completed' | 'failed'
  extraction_error?: string | null
}

type ListFilesResponse = { files: UploadedFile[] }

type SummaryLength = 'short' | 'medium' | 'long'

type SummaryResponse = { summary: string; provider?: string }

type HighlightColor = 'amber' | 'emerald' | 'violet'

type ManualTerm = { term: string; color: HighlightColor }

function cleanMarkdown(s: string): string {
  return s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}

function extractKeywordsFromSummary(summary: string, maxTerms = 10): string[] {
  const stop = new Set([
    'the',
    'and',
    'or',
    'but',
    'to',
    'of',
    'in',
    'on',
    'for',
    'with',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'that',
    'this',
    'these',
    'those',
    'as',
    'by',
    'at',
    'from',
    'it',
    'its',
    'into',
    'can',
    'may',
    'will',
    'also',
    'than',
    'then',
    'under',
    'over',
    'between',
    'within',
    'without',
    'via',
    'not',
    'no',
    'yes',
    'such',
    'more',
    'most',
    'less',
    'least',
  ])

  const text = cleanMarkdown(summary)
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 5 && !stop.has(w))

  const freq = new Map<string, number>()
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1)

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, maxTerms)
}

function termsFromSelection(selection: string): string[] {
  const s = selection.trim()
  if (!s) return []
  if (s.length <= 40) return [cleanMarkdown(s)]

  const words = s
    .replace(/\r\n?/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4)

  const uniq: string[] = []
  for (const w of words) {
    const lw = w.toLowerCase()
    if (uniq.some((u) => u.toLowerCase() === lw)) continue
    uniq.push(w)
    if (uniq.length >= 10) break
  }
  return uniq
}

function colorClass(c: HighlightColor): string {
  if (c === 'emerald') return 'bg-emerald-200/45'
  if (c === 'violet') return 'bg-violet-200/45'
  return 'bg-amber-200/50'
}

export default function HighlighterClient() {
  const router = useRouter()

  const [loadingFiles, setLoadingFiles] = React.useState(false)
  const [files, setFiles] = React.useState<UploadedFile[]>([])
  const [filesError, setFilesError] = React.useState<string | null>(null)

  const [selectedId, setSelectedId] = React.useState<string>('')
  const [selectedPdfText, setSelectedPdfText] = React.useState('')

  const [viewerBlob, setViewerBlob] = React.useState<Blob | null>(null)
  const [viewerName, setViewerName] = React.useState('')
  const [viewerError, setViewerError] = React.useState<string | null>(null)
  const [viewerLoading, setViewerLoading] = React.useState(false)

  const [manualTerms, setManualTerms] = React.useState<ManualTerm[]>([])
  const [manualColor, setManualColor] = React.useState<HighlightColor>('amber')

  const [focusQuery, setFocusQuery] = React.useState('')

  const [summary, setSummary] = React.useState<string>('')
  const [provider, setProvider] = React.useState<string>('')
  const [summaryLoading, setSummaryLoading] = React.useState(false)
  const [summaryError, setSummaryError] = React.useState<string | null>(null)
  const [summaryLength, setSummaryLength] = React.useState<SummaryLength>('medium')

  const authed = !!getAccessToken()

  const selected = React.useMemo(() => files.find((f) => f.id === selectedId) || null, [files, selectedId])

  const highlightRules: HighlightRule[] = React.useMemo(() => {
    const out: HighlightRule[] = []

    // 1) Manual selection highlights (highest priority)
    for (const m of manualTerms) {
      if (!m.term.trim()) continue
      out.push({ term: m.term, className: colorClass(m.color) })
    }

    // 2) Focus/search query
    const q = focusQuery.trim()
    if (q) {
      out.push({ term: q, className: 'bg-amber-200/50' })
      return out
    }

    // 3) Summary fallback
    if (summary) {
      for (const kw of extractKeywordsFromSummary(summary)) {
        out.push({ term: kw, className: 'bg-violet-200/45' })
      }
    }

    return out
  }, [manualTerms, focusQuery, summary])

  async function loadFiles() {
    setLoadingFiles(true)
    setFilesError(null)
    try {
      const res = await backendFetch<ListFilesResponse>('/api/files', { method: 'GET' })
      const list = res.files || []
      setFiles(list)

      const fromQuery = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('fileId') || '' : ''
      const fallback = fromQuery && list.some((f) => f.id === fromQuery) ? fromQuery : list[0]?.id || ''
      if (!selectedId && fallback) setSelectedId(fallback)
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : 'Failed to load files')
      setFiles([])
    } finally {
      setLoadingFiles(false)
    }
  }

  async function openSelectedPdf(fileId: string) {
    const file = files.find((f) => f.id === fileId)
    if (!file) return

    setViewerLoading(true)
    setViewerError(null)
    setViewerBlob(null)
    setViewerName(file.original_file_name)

    try {
      const blob = await backendFetchBlob(`/api/files/${fileId}/content`, { method: 'GET' })
      if (!file.mime_type.includes('pdf')) {
        setViewerError('Highlighter only supports PDFs right now.')
        return
      }
      setViewerBlob(blob)
    } catch (e) {
      setViewerError(e instanceof Error ? e.message : 'Failed to open file')
    } finally {
      setViewerLoading(false)
    }
  }

  function addManualHighlightFromSelection() {
    const terms = termsFromSelection(selectedPdfText)
    if (!terms.length) return

    setManualTerms((prev) => {
      const next = [...prev]
      for (const t of terms) {
        if (next.some((x) => x.term.toLowerCase() === t.toLowerCase())) continue
        next.push({ term: t, color: manualColor })
      }
      return next
    })
    setSelectedPdfText('')
  }

  async function generateSummary() {
    if (!selectedId) return
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const payload = JSON.stringify({ file_id: selectedId, focus: focusQuery.trim() || undefined, length: summaryLength })
      const res = await backendFetch<SummaryResponse>('/api/summaries', {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json' },
      })
      setSummary(res.summary || '')
      setProvider(res.provider || '')
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Summarization failed')
      setSummary('')
      setProvider('')
    } finally {
      setSummaryLoading(false)
    }
  }

  React.useEffect(() => {
    if (!authed) {
      router.replace('/login')
      return
    }
    loadFiles().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  React.useEffect(() => {
    // reset state when file changes
    setViewerBlob(null)
    setViewerName('')
    setViewerError(null)
    setSelectedPdfText('')
    setManualTerms([])
    setSummary('')
    setProvider('')
    setSummaryError(null)
  }, [selectedId])

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">PDF Highlighter</h1>
            <p className="text-sm text-zinc-600">Highlights are visual only; your document content is unchanged.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-xl border bg-white px-4 py-2 text-sm" onClick={() => router.push('/dashboard/files')}>
              Back to uploads
            </button>
            <button
              className="rounded-xl border bg-white px-4 py-2 text-sm"
              onClick={() => {
                clearAccessToken()
                router.replace('/login')
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Pick a PDF</h2>
                <p className="mt-1 text-sm text-zinc-600">Select a completed PDF to load it into the highlighter.</p>
              </div>
              <button className="rounded-xl border px-3 py-1.5 text-sm" onClick={loadFiles} disabled={loadingFiles}>
                {loadingFiles ? 'Loading…' : 'Reload'}
              </button>
            </div>

            {filesError ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{filesError}</div> : null}

            <div className="mt-4">
              <div className="text-xs text-zinc-500">File</div>
              <select
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                disabled={!files.length}
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

              <button
                className="mt-4 w-full rounded-xl border bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => openSelectedPdf(selectedId)}
                disabled={!selectedId || selected?.processing_status !== 'completed' || viewerLoading}
              >
                {viewerLoading ? 'Opening…' : 'Open in highlighter'}
              </button>

              {viewerError ? <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{viewerError}</div> : null}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <h2 className="text-base font-semibold">Highlight controls</h2>
            <p className="mt-1 text-sm text-zinc-600">Priority: manual selection → focus query → AI summary keywords.</p>

            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border p-4">
                <div className="text-xs text-zinc-500">Manual (select text in the PDF)</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-lg border bg-white px-2 py-1 text-xs"
                    value={manualColor}
                    onChange={(e) => setManualColor(e.target.value as HighlightColor)}
                    disabled={!viewerBlob}
                  >
                    <option value="amber">Amber</option>
                    <option value="emerald">Emerald</option>
                    <option value="violet">Violet</option>
                  </select>

                  <button
                    className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
                    onClick={addManualHighlightFromSelection}
                    disabled={!viewerBlob || !selectedPdfText}
                  >
                    Highlight selection
                  </button>

                  <button
                    className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
                    onClick={() => setManualTerms([])}
                    disabled={!manualTerms.length}
                  >
                    Clear manual
                  </button>
                </div>

                {selectedPdfText ? (
                  <div className="mt-2 truncate text-xs text-zinc-600">
                    Selected: <span className="font-medium">{selectedPdfText}</span>
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs text-zinc-500">Focus / search query</div>
                <input
                  className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Type a word/phrase to highlight"
                  value={focusQuery}
                  onChange={(e) => setFocusQuery(e.target.value)}
                  disabled={!viewerBlob}
                />
                <div className="mt-2 text-xs text-zinc-500">If empty, summary keywords are used as fallback.</div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-zinc-500">AI summary (fallback)</div>
                    <div className="text-xs text-zinc-500">Generate a summary to derive highlight keywords.</div>
                  </div>
                  {provider ? <span className="rounded-full bg-violet-50 px-3 py-2 text-xs text-violet-700">Used: {provider}</span> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-lg border bg-white px-2 py-1 text-xs"
                    value={summaryLength}
                    onChange={(e) => setSummaryLength(e.target.value as SummaryLength)}
                    disabled={summaryLoading}
                  >
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </select>

                  <button
                    className="rounded-lg border bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                    onClick={generateSummary}
                    disabled={!selectedId || summaryLoading || selected?.processing_status !== 'completed'}
                  >
                    {summaryLoading ? 'Summarizing…' : 'Generate summary'}
                  </button>

                  <button
                    className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
                    onClick={() => {
                      setSummary('')
                      setProvider('')
                      setSummaryError(null)
                    }}
                    disabled={!summary}
                  >
                    Clear summary
                  </button>
                </div>

                {summaryError ? <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{summaryError}</div> : null}

                {summary ? (
                  <div className="mt-3 rounded-xl border border-dashed bg-zinc-50 p-3">
                    <div className="text-xs text-zinc-500">Summary</div>
                    <div className="mt-2">
                      <SummaryRenderer text={summary} />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-base font-semibold">Viewer</h2>
          <p className="mt-1 text-sm text-zinc-600">Tip: select text in the PDF, then click “Highlight selection”.</p>

          <div className="mt-4">
            {viewerBlob ? (
              <PdfHighlighterViewer blob={viewerBlob} rules={highlightRules} onSelectionText={setSelectedPdfText} />
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-zinc-500">Open a PDF to start highlighting.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
