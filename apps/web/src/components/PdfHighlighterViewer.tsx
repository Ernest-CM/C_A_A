'use client'

import React from 'react'

type HighlightRule = {
  term: string
  className: string
}

type Props = {
  blob: Blob
  rules: HighlightRule[]
  onSelectionText?: (text: string) => void
}

const HIGHLIGHT_CLASSES = [
  'bg-amber-200/50',
  'bg-emerald-200/45',
  'bg-violet-200/45',
  'rounded-sm',
]

function normalize(s: string): string {
  return s.toLowerCase()
}

function applyHighlights(textLayer: HTMLElement, rules: HighlightRule[]) {
  const spans = Array.from(textLayer.querySelectorAll('span')) as HTMLElement[]

  for (const span of spans) {
    span.classList.remove(...HIGHLIGHT_CLASSES)
    for (const r of rules) {
      if (r.className) span.classList.remove(...r.className.split(/\s+/).filter(Boolean))
    }

    const t = (span.textContent || '').trim()
    if (!t) continue

    const normalized = normalize(t)
    const matched = rules.find((r) => r.term && normalized.includes(normalize(r.term)))
    if (!matched) continue

    if (matched.className) span.classList.add(...matched.className.split(/\s+/).filter(Boolean))
    span.classList.add(...HIGHLIGHT_CLASSES)
  }
}

export function PdfHighlighterViewer({ blob, rules, onSelectionText }: Props) {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [numPages, setNumPages] = React.useState(0)

  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const textLayerRefs = React.useRef<Array<HTMLDivElement | null>>([])

  const rulesRef = React.useRef<HighlightRule[]>(rules)
  React.useEffect(() => {
    rulesRef.current = rules
    // apply on existing pages
    for (const layer of textLayerRefs.current) {
      if (layer) applyHighlights(layer, rules)
    }
  }, [rules])

  React.useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError(null)
      setNumPages(0)
      textLayerRefs.current = []

      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

        // Prefer a real worker (more reliable for complex PDFs). If the worker URL
        // cannot be resolved in this environment, we fall back to disableWorker.
        try {
          ;(pdfjs as any).GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/legacy/build/pdf.worker.mjs',
            import.meta.url,
          ).toString()
        } catch {
          // ignore
        }

        const data = new Uint8Array(await blob.arrayBuffer())

        let loadingTask = (pdfjs as any).getDocument({ data })
        let doc: any
        try {
          doc = await loadingTask.promise
        } catch {
          // Fallback: some Next/webpack setups struggle to load the worker.
          try {
            loadingTask?.destroy?.()
          } catch {
            // ignore
          }
          loadingTask = (pdfjs as any).getDocument({ data, disableWorker: true })
          doc = await loadingTask.promise
        }

        if (cancelled) return

        setNumPages(doc.numPages)

        // Render pages sequentially (simplest, reliable).
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          if (cancelled) return

          const page = await doc.getPage(pageNumber)

          // scale to readable width
          const viewport = page.getViewport({ scale: 1.35 })

          const pageContainer = document.createElement('div')
          pageContainer.className = 'pdf-page relative my-3 overflow-hidden rounded-xl border bg-white'

          const canvas = document.createElement('canvas')
          const canvasContext = canvas.getContext('2d')
          if (!canvasContext) throw new Error('Canvas not supported')

          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.className = 'block w-full h-auto'

          const canvasWrap = document.createElement('div')
          canvasWrap.className = 'relative'
          canvasWrap.appendChild(canvas)

          const textLayer = document.createElement('div')
          textLayer.className = 'textLayer'
          canvasWrap.appendChild(textLayer)

          const pageLabel = document.createElement('div')
          pageLabel.className = 'border-b px-3 py-2 text-xs text-zinc-600'
          pageLabel.textContent = `Page ${pageNumber}`

          pageContainer.appendChild(pageLabel)
          pageContainer.appendChild(canvasWrap)

          rootRef.current?.appendChild(pageContainer)

          // Render canvas
          await page.render({ canvasContext, viewport }).promise

          // Render text layer (PDF.js v5 API)
          const textContent = await page.getTextContent()
          const textLayerTask = new (pdfjs as any).TextLayer({
            textContentSource: textContent,
            container: textLayer,
            viewport,
          })
          await textLayerTask.render()

          // save ref and apply highlights
          textLayerRefs.current[pageNumber - 1] = textLayer
          applyHighlights(textLayer, rulesRef.current)
        }

        if (!cancelled) setLoading(false)
      } catch (e) {
        if (cancelled) return
        const message = e instanceof Error ? e.message : 'Failed to render PDF'
        setError(message)
        setLoading(false)
      }
    }

    // clear previous render
    if (rootRef.current) rootRef.current.innerHTML = ''
    run()

    return () => {
      cancelled = true
    }
  }, [blob])

  function handleMouseUp() {
    if (!onSelectionText) return
    const sel = window.getSelection()?.toString() || ''
    onSelectionText(sel.trim())
  }

  return (
    <div onMouseUp={handleMouseUp}>
      <style jsx global>{`
        /* Minimal pdf.js text layer styling */
        .pdf-page canvas {
          display: block;
        }
        .pdf-page .textLayer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          opacity: 1;
          line-height: 1;
          user-select: text;
        }
        .pdf-page .textLayer span {
          position: absolute;
          transform-origin: 0% 0%;
          white-space: pre;
          cursor: text;
        }
      `}</style>

      {loading ? (
        <div className="rounded-xl border border-dashed p-6 text-sm text-zinc-500">Loading PDF…</div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : (
        <div className="text-xs text-zinc-500">Pages: {numPages}</div>
      )}

      <div ref={rootRef} className="mt-2" />
    </div>
  )
}

export type { HighlightRule }
