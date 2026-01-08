'use client'

import { useState } from 'react'

import { backendFetch } from '@/lib/backend'

export function FileUploader({ onUploaded }: { onUploaded: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onPickFiles(files: FileList | null) {
    setError(null)
    if (!files || !files.length) return

    setBusy(true)
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', f)
        await backendFetch(`/api/files?category=lecture-notes`, { method: 'POST', body: fd })
      }
      onUploaded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label
        className={
          `block rounded-2xl border-2 border-dashed border-zinc-800 bg-zinc-950/20 p-6 text-center ` +
          (busy ? 'opacity-60' : 'hover:bg-zinc-950/30')
        }
      >
        <input
          className="hidden"
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg"
          disabled={busy}
          onChange={(e) => onPickFiles(e.target.files)}
        />
        <div className="text-sm text-zinc-200">
          <div className="font-medium">Click to upload PDFs/images</div>
          <div className="text-zinc-400">(you can select multiple files)</div>
        </div>
      </label>

      {busy ? <div className="text-sm text-zinc-400">Uploading…</div> : null}
      {error ? <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}
    </div>
  )
}
