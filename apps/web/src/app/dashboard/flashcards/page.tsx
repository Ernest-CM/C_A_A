'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { backendFetch } from '@/lib/backend'
import { clearAccessToken, getAccessToken } from '@/lib/authToken'

type UploadedFile = {
  id: string
  original_file_name: string
  processing_status: 'pending' | 'processing' | 'completed' | 'failed'
  extraction_error?: string | null
}

type ListFilesResponse = { files: UploadedFile[] }

type Flashcard = { id: number; front: string; back: string }

type FlashcardsPayload = { title?: string; cards: Flashcard[] }

type FlashcardsResponse = {
  file_ids: string[]
  provider?: string
  flashcards: FlashcardsPayload
}

export default function FlashcardsPage() {
  const router = useRouter()

  const [loadingFiles, setLoadingFiles] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [files, setFiles] = useState<UploadedFile[]>([])

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numCards, setNumCards] = useState<number>(20)

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [provider, setProvider] = useState<string>('')
  const [deck, setDeck] = useState<FlashcardsPayload | null>(null)

  const [index, setIndex] = useState(0)
  const [showBack, setShowBack] = useState(false)

  const authed = !!getAccessToken()

  const completedFiles = useMemo(() => files.filter((f) => f.processing_status === 'completed'), [files])

  const current = deck?.cards?.[index] || null

  async function loadFiles() {
    setLoadingFiles(true)
    setFilesError(null)
    try {
      const res = await backendFetch<ListFilesResponse>('/api/files', { method: 'GET' })
      const list = res.files || []
      setFiles(list)

      // Default selection: first completed file
      if (!selectedIds.length) {
        const firstCompleted = list.find((f) => f.processing_status === 'completed')
        if (firstCompleted) setSelectedIds([firstCompleted.id])
      }
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : 'Failed to load files')
      setFiles([])
    } finally {
      setLoadingFiles(false)
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function generate() {
    if (!selectedIds.length) return

    setGenerating(true)
    setGenError(null)
    setDeck(null)
    setProvider('')
    setIndex(0)
    setShowBack(false)

    try {
      const res = await backendFetch<FlashcardsResponse>('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: selectedIds, num_cards: numCards }),
      })

      setDeck(res.flashcards)
      setProvider(res.provider || '')
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Flashcards generation failed')
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    if (!authed) {
      router.replace('/login')
      return
    }
    loadFiles().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  function signOut() {
    clearAccessToken()
    router.replace('/login')
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Flashcards</h1>
            <p className="text-sm text-zinc-600">Pick note(s), generate a deck, and study.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-xl border bg-white px-4 py-2 text-sm" onClick={() => router.push('/dashboard/files')}>
              Back to uploads
            </button>
            <button className="rounded-xl border bg-white px-4 py-2 text-sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Inputs</h2>
                <p className="mt-1 text-sm text-zinc-600">Only completed notes can be used.</p>
              </div>
              <button className="rounded-xl border px-3 py-1.5 text-sm" onClick={loadFiles} disabled={loadingFiles}>
                {loadingFiles ? 'Loading…' : 'Reload'}
              </button>
            </div>

            {filesError ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{filesError}</div> : null}

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs text-zinc-500">Notes</div>
                <div className="mt-2 max-h-64 space-y-2 overflow-auto rounded-xl border p-3">
                  {completedFiles.length ? (
                    completedFiles.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(f.id)}
                          onChange={() => toggleSelected(f.id)}
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
                <div className="mt-1 text-xs text-zinc-500">Selected: {selectedIds.length}</div>
              </div>

              <div>
                <div className="text-xs text-zinc-500">Number of cards</div>
                <input
                  className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
                  type="number"
                  min={1}
                  max={100}
                  value={numCards}
                  onChange={(e) => setNumCards(Math.max(1, Math.min(100, Number(e.target.value || 1))))}
                />
                <div className="mt-1 text-xs text-zinc-500">Tip: start with 15–25 for fastest results.</div>
              </div>

              <button
                className="w-full rounded-xl border bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={generate}
                disabled={!selectedIds.length || generating}
              >
                {generating ? 'Generating…' : 'Generate flashcards'}
              </button>

              {provider ? (
                <div className="text-xs text-zinc-500">
                  Provider: <span className="font-medium">{provider}</span>
                </div>
              ) : null}

              {genError ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{genError}</div> : null}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <div>
              <h2 className="text-base font-semibold">Deck</h2>
              <p className="mt-1 text-sm text-zinc-600">Click the card to flip.</p>
            </div>

            {!deck ? (
              <div className="mt-4 rounded-xl border border-dashed p-6 text-sm text-zinc-500">Generate a deck to see it here.</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-xs text-zinc-500">Title</div>
                  <div className="mt-1 text-sm font-semibold">{deck.title || 'Flashcards'}</div>
                </div>

                <div className="text-xs text-zinc-500">
                  Card {index + 1} of {deck.cards.length}
                </div>

                <button
                  type="button"
                  className="w-full rounded-2xl border bg-white p-6 text-left"
                  onClick={() => setShowBack((v) => !v)}
                >
                  <div className="text-xs text-zinc-500">{showBack ? 'Back' : 'Front'}</div>
                  <div className="mt-2 text-base font-semibold">{showBack ? current?.back : current?.front}</div>
                </button>

                <div className="flex items-center justify-between gap-2">
                  <button
                    className="rounded-xl border bg-white px-4 py-2 text-sm disabled:opacity-50"
                    onClick={() => {
                      setIndex((i) => Math.max(0, i - 1))
                      setShowBack(false)
                    }}
                    disabled={index <= 0}
                  >
                    Prev
                  </button>
                  <button
                    className="rounded-xl border bg-white px-4 py-2 text-sm disabled:opacity-50"
                    onClick={() => {
                      setIndex((i) => Math.min((deck.cards?.length || 1) - 1, i + 1))
                      setShowBack(false)
                    }}
                    disabled={index >= (deck.cards?.length || 1) - 1}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
