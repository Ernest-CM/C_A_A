'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { backendFetch } from '@/lib/backend'
import { clearAccessToken, getAccessToken } from '@/lib/authToken'

type UploadedFile = {
  id: string
  original_file_name: string
  processing_status: 'pending' | 'processing' | 'completed' | 'failed'
}

type ListFilesResponse = { files: UploadedFile[] }

type MindmapNode = {
  id: string
  label: string
  children: MindmapNode[]
}

type MindmapPayload = {
  title: string
  root: MindmapNode
}

type MindmapResponse = {
  file_id: string
  provider?: string
  mindmap: MindmapPayload
}

type SectionSummaryResponse = {
  file_id: string
  topic: string
  provider?: string
  summary: string
}

function escapeHtml(s: string): string {
  return (s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function toMarkdown(root: MindmapNode): string {
  const lines: string[] = []

  const walk = (node: MindmapNode, depth: number) => {
    const indent = '  '.repeat(depth)
    const d = Math.max(1, depth + 1)
    const safe = escapeHtml(node.label)
    // Render label as a chip so we can apply modern styling inside markmap nodes.
    lines.push(`${indent}- <span class="mm-chip mm-d${d}">${safe}</span>`)
    for (const child of node.children || []) {
      walk(child, depth + 1)
    }
  }

  walk(root, 0)
  return lines.join('\n')
}

export default function MindmapsClient({ initialFileId }: { initialFileId: string }) {
  const router = useRouter()

  const [loadingFiles, setLoadingFiles] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [files, setFiles] = useState<UploadedFile[]>([])

  const [selectedId, setSelectedId] = useState<string>(initialFileId)

  const [maxDepth, setMaxDepth] = useState<number>(6)
  const [maxNodes, setMaxNodes] = useState<number>(80)

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [provider, setProvider] = useState<string>('')
  const [mindmap, setMindmap] = useState<MindmapPayload | null>(null)

  const [selectedTopic, setSelectedTopic] = useState<string>('')
  const [summarySize, setSummarySize] = useState<'small' | 'medium'>('small')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [summaryText, setSummaryText] = useState<string>('')

  const svgRef = useRef<SVGSVGElement | null>(null)
  const markmapRef = useRef<any>(null)

  const authed = !!getAccessToken()
  const completedFiles = useMemo(() => files.filter((f) => f.processing_status === 'completed'), [files])
  const markdown = useMemo(() => (mindmap ? toMarkdown(mindmap.root) : ''), [mindmap])

  async function loadFiles() {
    setLoadingFiles(true)
    setFilesError(null)
    try {
      const res = await backendFetch<ListFilesResponse>('/api/files', { method: 'GET' })
      const list = res.files || []
      setFiles(list)

      if (!selectedId) {
        const firstCompleted = list.find((f) => f.processing_status === 'completed')
        if (firstCompleted) setSelectedId(firstCompleted.id)
      }
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : 'Failed to load files')
      setFiles([])
    } finally {
      setLoadingFiles(false)
    }
  }

  async function renderMarkmap(md: string) {
    if (!svgRef.current || !md) return

    const [{ Transformer }, { Markmap }] = await Promise.all([import('markmap-lib'), import('markmap-view')])

    const transformer = new Transformer()
    const { root } = transformer.transform(md)

    // Ensure the element has measurable size when Markmap reads layout.
    svgRef.current.setAttribute('width', '100%')
    svgRef.current.setAttribute('height', '100%')

    // "Unique flow": show only the first-level branches initially.
    // Deeper branches are revealed when a branch label is clicked.
    const opts = {
      autoFit: true,
      initialExpandLevel: 2,
      toggleRecursively: false,
      zoom: true,
      pan: true,
      // Give nodes more breathing room.
      spacingHorizontal: 180,
      spacingVertical: 32,
      paddingX: 18,
      nodeMinHeight: 22,
      // Depth-based coloring for a more modern look.
      color: (node: any) => {
        const depth = Number(node?.state?.depth || 1)
        if (depth <= 1) return '#6d28d9' // violet-700
        if (depth === 2) return '#2563eb' // blue-600
        if (depth === 3) return '#059669' // emerald-600
        return '#0f766e' // teal-700
      },
      lineWidth: (node: any) => {
        const depth = Number(node?.state?.depth || 1)
        return depth <= 2 ? 2.5 : 2
      },
    }

    if (!markmapRef.current) {
      while (svgRef.current.firstChild) svgRef.current.removeChild(svgRef.current.firstChild)
      markmapRef.current = Markmap.create(svgRef.current, opts as any, root)
    } else {
      await markmapRef.current.setData(root, opts as any)
    }
  }

  function extractTopicFromNodeElement(el: Element): string {
    const foreign = el.querySelector('.markmap-foreign') as HTMLElement | null
    const t = (foreign?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim()
    return t
  }

  function normalizeClickTarget(raw: EventTarget | null): Element | null {
    if (!raw) return null
    // Text nodes are common when clicking label text inside foreignObject.
    const anyTarget = raw as any
    if (anyTarget.nodeType === 3) {
      return anyTarget.parentElement || null
    }
    if (anyTarget instanceof Element) return anyTarget
    return null
  }

  async function fetchSectionSummary(topic: string, size: 'small' | 'medium') {
    if (!selectedId || !topic) return
    setSummaryLoading(true)
    setSummaryError(null)
    setSummaryText('')

    try {
      const res = await backendFetch<SectionSummaryResponse>('/api/mindmaps/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: selectedId, topic, size }),
      })
      setSummaryText(res.summary || '')
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Failed to fetch section summary')
    } finally {
      setSummaryLoading(false)
    }
  }

  async function generate() {
    if (!selectedId) return

    setGenerating(true)
    setGenError(null)
    setRenderError(null)
    setMindmap(null)
    setProvider('')

    setSelectedTopic('')
    setSummaryError(null)
    setSummaryText('')

    try {
      const res = await backendFetch<MindmapResponse>('/api/mindmaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: selectedId, max_depth: maxDepth, max_nodes: maxNodes }),
      })

      setMindmap(res.mindmap)
      setProvider(res.provider || '')
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Mindmap generation failed')
    } finally {
      setGenerating(false)
    }
  }

  // Render after the SVG is mounted and the markdown is available.
  useEffect(() => {
    if (!mindmap || !markdown) return

    let cancelled = false
    const run = async () => {
      try {
        // Two rAFs helps ensure layout is settled.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        if (cancelled) return
        await renderMarkmap(markdown)
      } catch (e) {
        if (cancelled) return
        setRenderError(e instanceof Error ? e.message : 'Failed to render mind map')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mindmap, markdown])

  useEffect(() => {
    if (!authed) {
      router.replace('/login')
      return
    }
    loadFiles().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Click-to-reveal branches + show a section summary.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const handler = (ev: MouseEvent) => {
      const target = normalizeClickTarget(ev.target)
      if (!target) return

      // Only react to label clicks ("branch name is clicked").
      // In some browsers, the closest chain from HTML inside foreignObject may not reach the SVG <g>.
      // We therefore first locate the label container, then hop to the nearest SVG node group.
      const labelEl = target.closest('.markmap-foreign') as Element | null
      if (!labelEl) return

      const nodeEl = (labelEl.closest('g.markmap-node') || target.closest('g.markmap-node')) as SVGGElement | null
      if (!nodeEl) return

      // Toggle children (if any)
      const mm = markmapRef.current
      const dataPath = nodeEl.getAttribute('data-path')
      if (mm && dataPath && mm.state?.data) {
        const findByPath = (n: any): any => {
          if (!n) return null
          if (n.state?.path === dataPath) return n
          const kids = n.children || []
          for (const c of kids) {
            const hit = findByPath(c)
            if (hit) return hit
          }
          return null
        }
        const nodeData = findByPath(mm.state.data)
        if (nodeData && nodeData.children && nodeData.children.length) {
          void mm.toggleNode(nodeData, false)
        }
      }

      // Fetch summary
      const topic = (labelEl.textContent || '').replace(/\s+/g, ' ').trim() || extractTopicFromNodeElement(nodeEl)
      if (topic) {
        setSelectedTopic(topic)
        void fetchSectionSummary(topic, summarySize)
      }
    }

    // Use capture so clicks inside foreignObject reliably reach us.
    svg.addEventListener('click', handler, true)
    return () => {
      svg.removeEventListener('click', handler, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, summarySize])

  function signOut() {
    clearAccessToken()
    router.replace('/login')
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <style jsx global>{`
          /* Modern mind-map look (chips inside Markmap nodes) */
          .mm-chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-radius: 9999px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(24, 24, 27, 0.8);
            color: #e5e7eb;
            font-weight: 600;
            line-height: 1;
            user-select: none;
          }
          .mm-chip:hover {
            border-color: rgba(255, 255, 255, 0.18);
          }
          .mm-d1 { background: rgba(109, 40, 217, 0.15); border-color: rgba(109, 40, 217, 0.35); }
          .mm-d2 { background: rgba(37, 99, 235, 0.15); border-color: rgba(37, 99, 235, 0.35); }
          .mm-d3 { background: rgba(5, 150, 105, 0.15); border-color: rgba(5, 150, 105, 0.35); }
          .mm-d4, .mm-d5, .mm-d6, .mm-d7, .mm-d8 { background: rgba(15, 118, 110, 0.15); border-color: rgba(15, 118, 110, 0.35); }

          /* Make Markmap labels feel clickable */
          .markmap-foreign { cursor: pointer; }
          .markmap-foreign div { cursor: pointer; }
        `}</style>

        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Mind maps</h1>
            <p className="text-sm text-zinc-400">Generate a mind map from a single note.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-800" onClick={() => router.push('/dashboard/files')}>
              Back to uploads
            </button>
            <button className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-800" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Inputs</h2>
                <p className="mt-1 text-sm text-zinc-400">Only completed notes can be used.</p>
              </div>
              <button className="rounded-xl border border-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800" onClick={loadFiles} disabled={loadingFiles}>
                {loadingFiles ? 'Loading…' : 'Reload'}
              </button>
            </div>

            {filesError ? <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{filesError}</div> : null}

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs text-zinc-500">Note</div>
                <div className="mt-2 max-h-64 space-y-2 overflow-auto rounded-xl border border-zinc-800 p-3">
                  {completedFiles.length ? (
                    completedFiles.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="mindmap-note"
                          checked={selectedId === f.id}
                          onChange={() => setSelectedId(f.id)}
                          disabled={generating}
                        />
                        <span className="truncate" title={f.original_file_name}>
                          {f.original_file_name}
                        </span>
                      </label>
                    ))
                  ) : (
                    <div className="text-sm text-zinc-500">No completed notes yet.</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Max depth</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-100"
                    type="number"
                    min={2}
                    max={8}
                    value={maxDepth}
                    onChange={(e) => setMaxDepth(Math.max(2, Math.min(8, Number(e.target.value || 4))))}
                  />
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Max nodes</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-100"
                    type="number"
                    min={10}
                    max={200}
                    value={maxNodes}
                    onChange={(e) => setMaxNodes(Math.max(10, Math.min(200, Number(e.target.value || 40))))}
                  />
                </div>
              </div>

              <button
                className="w-full rounded-xl border border-indigo-600 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                onClick={generate}
                disabled={!selectedId || generating}
              >
                {generating ? 'Generating…' : 'Generate mind map'}
              </button>

              {provider ? (
                <div className="text-xs text-zinc-500">
                  Provider: <span className="font-medium">{provider}</span>
                </div>
              ) : null}

              {genError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{genError}</div> : null}
              {renderError ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                  Render error: {renderError}
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div>
              <h2 className="text-base font-semibold">Mind map</h2>
              <p className="mt-1 text-sm text-zinc-400">Pan/zoom is supported. Regenerate to update.</p>
            </div>

            {!mindmap ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-800 p-6 text-sm text-zinc-500">Generate a mind map to see it here.</div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="text-sm font-semibold">{mindmap.title}</div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950" style={{ height: '70vh', overflow: 'hidden' }}>
                  <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
                </div>
                {markdown ? <div className="text-xs text-zinc-500">Click a branch label to reveal sub-branches.</div> : null}

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-zinc-500">Selected branch</div>
                      <div className="mt-1 text-sm font-semibold">{selectedTopic || '—'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded-lg border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-100"
                        value={summarySize}
                        onChange={(e) => {
                          const v = e.target.value === 'medium' ? 'medium' : 'small'
                          setSummarySize(v)
                          if (selectedTopic) void fetchSectionSummary(selectedTopic, v)
                        }}
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-200">
                    {summaryLoading ? 'Loading summary…' : summaryText || 'Click a branch to see its explanation.'}
                  </div>
                  {summaryError ? <div className="mt-2 text-sm text-red-300">{summaryError}</div> : null}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
