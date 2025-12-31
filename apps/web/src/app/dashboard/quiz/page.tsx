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

type QuizOption = { label: 'A' | 'B' | 'C' | 'D'; text: string }

type QuizQuestion = {
  id: number
  question: string
  options: QuizOption[]
  answer: 'A' | 'B' | 'C' | 'D'
  explanation?: string
}

type Quiz = {
  title?: string
  questions: QuizQuestion[]
}

type QuizResponse = {
  file_ids: string[]
  provider?: string
  quiz: Quiz
}

export default function QuizPage() {
  const router = useRouter()

  const [loadingFiles, setLoadingFiles] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [files, setFiles] = useState<UploadedFile[]>([])

  const [selectedId, setSelectedId] = useState<string>('')
  const [numQuestions, setNumQuestions] = useState<number>(10)

  const [generating, setGenerating] = useState(false)
  const [quizError, setQuizError] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [provider, setProvider] = useState<string>('')

  const authed = !!getAccessToken()

  const selected = useMemo(() => files.find((f) => f.id === selectedId) || null, [files, selectedId])

  async function loadFiles() {
    setLoadingFiles(true)
    setFilesError(null)
    try {
      const res = await backendFetch<ListFilesResponse>('/api/files', { method: 'GET' })
      const list = res.files || []
      setFiles(list)

      const fromQuery = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('fileId') || '' : ''
      const fallback = fromQuery && list.some((f) => f.id === fromQuery) ? fromQuery : selectedId || list[0]?.id || ''
      if (fallback) setSelectedId(fallback)
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : 'Failed to load files')
      setFiles([])
    } finally {
      setLoadingFiles(false)
    }
  }

  async function generate() {
    if (!selectedId) return
    setGenerating(true)
    setQuizError(null)
    setQuiz(null)
    setProvider('')

    try {
      const res = await backendFetch<QuizResponse>('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: [selectedId], num_questions: numQuestions }),
      })

      setQuiz(res.quiz)
      setProvider(res.provider || '')
    } catch (e) {
      setQuizError(e instanceof Error ? e.message : 'Quiz generation failed')
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
            <h1 className="text-2xl font-semibold">Quiz Generator</h1>
            <p className="text-sm text-zinc-600">Pick a note, choose the number of questions, and generate a quiz.</p>
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
                <div className="text-xs text-zinc-500">Note</div>
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
                {selected?.extraction_error ? (
                  <div className="mt-2 text-xs text-red-700">{selected.extraction_error}</div>
                ) : null}
              </div>

              <div>
                <div className="text-xs text-zinc-500">Number of questions</div>
                <input
                  className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
                  type="number"
                  min={1}
                  max={50}
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(Math.max(1, Math.min(50, Number(e.target.value || 1))))}
                />
                <div className="mt-1 text-xs text-zinc-500">Tip: start with 5–10 for fastest results.</div>
              </div>

              <button
                className="w-full rounded-xl border bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={generate}
                disabled={!selectedId || generating || selected?.processing_status !== 'completed'}
              >
                {generating ? 'Generating…' : 'Generate quiz'}
              </button>

              {provider ? (
                <div className="text-xs text-zinc-500">
                  Provider: <span className="font-medium">{provider}</span>
                </div>
              ) : null}

              {quizError ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{quizError}</div> : null}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Quiz</h2>
                <p className="mt-1 text-sm text-zinc-600">Answers are hidden under each question.</p>
              </div>
            </div>

            {!quiz ? (
              <div className="mt-4 rounded-xl border border-dashed p-6 text-sm text-zinc-500">Generate a quiz to see it here.</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-xs text-zinc-500">Title</div>
                  <div className="mt-1 text-sm font-semibold">{quiz.title || 'Quiz'}</div>
                </div>

                <div className="space-y-3">
                  {quiz.questions?.map((q, idx) => (
                    <div key={q.id ?? idx} className="rounded-xl border p-4">
                      <div className="text-sm font-semibold">
                        {idx + 1}. {q.question}
                      </div>
                      <div className="mt-3 grid gap-2 text-sm">
                        {(q.options || []).map((opt) => (
                          <div key={opt.label} className="rounded-lg border bg-white px-3 py-2">
                            <span className="font-semibold">{opt.label}.</span> {opt.text}
                          </div>
                        ))}
                      </div>

                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-zinc-700">Show answer</summary>
                        <div className="mt-2 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800">
                          <div>
                            Answer: <span className="font-semibold">{q.answer}</span>
                          </div>
                          {q.explanation ? <div className="mt-2 text-zinc-700">{q.explanation}</div> : null}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
