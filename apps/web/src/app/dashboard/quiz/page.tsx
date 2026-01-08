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
  type?: 'mcq' | 'theory'
  question: string
  options?: QuizOption[]
  answer?: 'A' | 'B' | 'C' | 'D'
  answer_text?: string
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

type GradeRequestItem = { id: number; question: string; answer_text: string }

type GradeResponse = {
  provider?: string
  grades: Array<{ id: number; score: number }>
}

export default function QuizPage() {
  const router = useRouter()

  const [loadingFiles, setLoadingFiles] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [files, setFiles] = useState<UploadedFile[]>([])

  const [selectedId, setSelectedId] = useState<string>('')
  const [numQuestions, setNumQuestions] = useState<number>(5)
  const [mode, setMode] = useState<'options' | 'theory' | 'both'>('options')

  const [timed, setTimed] = useState(false)
  const [timeMinutes, setTimeMinutes] = useState<number>(10)
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number | null>(null)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timeUp, setTimeUp] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [quizError, setQuizError] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [provider, setProvider] = useState<string>('')

  const [responses, setResponses] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [score, setScore] = useState<{ correct: number; total: number; percent: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const authed = !!getAccessToken()

  const selected = useMemo(() => files.find((f) => f.id === selectedId) || null, [files, selectedId])

  const recommendedMinutes = useMemo(() => {
    // Simple heuristic: MCQ ~ 1 min each, Theory ~ 2 min each.
    const mcqPerQuestion = 1
    const theoryPerQuestion = 2
    if (mode === 'options') return Math.max(1, Math.round(numQuestions * mcqPerQuestion))
    if (mode === 'theory') return Math.max(1, Math.round(numQuestions * theoryPerQuestion))
    // both
    const mcqCount = Math.ceil(numQuestions / 2)
    const theoryCount = numQuestions - mcqCount
    return Math.max(1, Math.round(mcqCount * mcqPerQuestion + theoryCount * theoryPerQuestion))
  }, [mode, numQuestions])

  const formattedTimeLeft = useMemo(() => {
    if (timeLeftSeconds === null) return ''
    const m = Math.max(0, Math.floor(timeLeftSeconds / 60))
    const s = Math.max(0, timeLeftSeconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }, [timeLeftSeconds])

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
    setResponses({})
    setSubmitted(false)
    setShowReview(false)
    setSubmitError(null)
    setScore(null)
    setTimerRunning(false)
    setTimeLeftSeconds(null)
    setTimeUp(false)

    try {
      const res = await backendFetch<QuizResponse>('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: [selectedId], num_questions: numQuestions, mode }),
      })

      setQuiz(res.quiz)
      setProvider(res.provider || '')

      if (timed) {
        const seconds = Math.max(60, Math.round(timeMinutes) * 60)
        setTimeLeftSeconds(seconds)
        setTimerRunning(true)
      }
    } catch (e) {
      setQuizError(e instanceof Error ? e.message : 'Quiz generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function questionKey(q: QuizQuestion, idx: number) {
    return String(typeof q.id === 'number' ? q.id : idx)
  }

  const allAnswered = useMemo(() => {
    if (!quiz?.questions?.length) return false
    return quiz.questions.every((q, idx) => {
      const ans = (responses[questionKey(q, idx)] || '').trim()
      return ans.length > 0
    })
  }, [quiz, responses])

  function chooseAnswer(key: string, value: string) {
    if (submitted) return
    setSubmitError(null)
    setResponses((prev) => ({ ...prev, [key]: value }))
  }

  async function submitQuiz(force: boolean = false) {
    if (!quiz?.questions?.length) return
    setSubmitError(null)

    if (!force && !allAnswered) {
      setSubmitError('Answer all questions before submitting.')
      return
    }

    setSubmitting(true)
    setTimerRunning(false)
    try {
      const total = quiz.questions.length

      // Score MCQs locally.
      let correct = 0
      const theoryItems: GradeRequestItem[] = []
      const theoryResponses: Record<string, string> = {}

      quiz.questions.forEach((q, idx) => {
        const key = questionKey(q, idx)
        const picked = (responses[key] || '').trim()
        const qType = q.type || 'mcq'

        if (qType === 'mcq') {
          if (picked && picked === q.answer) correct += 1
          return
        }

        const answerText = (q.answer_text || '').trim()
        theoryItems.push({ id: q.id, question: q.question, answer_text: answerText })
        theoryResponses[String(q.id)] = picked
      })

      // Score theory via backend LLM grader for accuracy.
      if (theoryItems.length) {
        const gradeRes = await backendFetch<GradeResponse>('/api/quizzes/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: theoryItems, responses: theoryResponses }),
        })

        const gradeMap = new Map<number, number>(gradeRes.grades.map((g) => [g.id, g.score]))
        // Convert continuous score to correct/incorrect. Threshold chosen for reasonable strictness.
        const threshold = 0.65
        theoryItems.forEach((it) => {
          const s = gradeMap.get(it.id) ?? 0
          if (s >= threshold) correct += 1
        })
      }

      const percent = total > 0 ? Math.round((correct / total) * 100) : 0
      setScore({ correct, total, percent })
      setSubmitted(true)
      setShowReview(false)
      setTimeUp(force)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  // Timer tick
  useEffect(() => {
    if (!timerRunning || submitted || timeLeftSeconds === null) return

    if (timeLeftSeconds <= 0) {
      setTimerRunning(false)
      // Auto-submit even if incomplete.
      submitQuiz(true).catch(() => {})
      return
    }

    const id = window.setInterval(() => {
      setTimeLeftSeconds((prev) => {
        if (prev === null) return prev
        return prev - 1
      })
    }, 1000)

    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning, submitted, timeLeftSeconds])

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
    <div className="p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Quiz Generator</h1>
            <p className="text-sm text-zinc-400">Pick a note, choose the number of questions, and generate a quiz.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-zinc-700 bg-zinc-900/40 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-900/60"
              onClick={() => router.push('/dashboard/files')}
            >
              Back to uploads
            </button>
            <button className="rounded-xl border border-zinc-700 bg-zinc-900/40 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-900/60" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Inputs</h2>
                <p className="mt-1 text-sm text-zinc-400">Only completed notes can be used.</p>
              </div>
              <button
                className="rounded-xl border border-zinc-700 bg-zinc-900/30 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-900/50 disabled:opacity-50"
                onClick={loadFiles}
                disabled={loadingFiles}
              >
                {loadingFiles ? 'Loading…' : 'Reload'}
              </button>
            </div>

            {filesError ? (
              <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{filesError}</div>
            ) : null}

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs text-zinc-500">Note</div>
                <select
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-100"
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
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-100"
                  type="number"
                  min={1}
                  max={50}
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(Math.max(1, Math.min(50, Number(e.target.value || 1))))}
                />
                <div className="mt-1 text-xs text-zinc-500">Tip: start with 5–10 for fastest results.</div>
              </div>

              <div>
                <div className="text-xs text-zinc-500">Mode</div>
                <select
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-100"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'options' | 'theory' | 'both')}
                  disabled={generating}
                >
                  <option value="options">Options only</option>
                  <option value="theory">Theory only</option>
                  <option value="both">Both</option>
                </select>
                <div className="mt-1 text-xs text-zinc-500">Tip: Options-only is fastest to grade.</div>
              </div>

              <div>
                <div className="text-xs text-zinc-500">Timed quiz</div>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={timed}
                    onChange={(e) => {
                      setTimed(e.target.checked)
                      setTimeUp(false)
                      if (e.target.checked && (!timeMinutes || timeMinutes < 1)) setTimeMinutes(recommendedMinutes)
                    }}
                    disabled={generating || submitted}
                  />
                  <span>Enable timer</span>
                </label>

                {timed ? (
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <div>
                      <div className="text-xs text-zinc-500">Time (minutes)</div>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-100"
                          type="number"
                          min={1}
                          value={timeMinutes}
                          onChange={(e) => setTimeMinutes(Math.max(1, Number(e.target.value || 1)))}
                          disabled={generating || timerRunning || submitted}
                        />
                        <button
                          type="button"
                          className="whitespace-nowrap rounded-xl border border-zinc-700 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-900/50"
                          onClick={() => setTimeMinutes(recommendedMinutes)}
                          disabled={generating || timerRunning || submitted}
                        >
                          Use recommended
                        </button>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">Recommended: {recommendedMinutes} min</div>
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
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

              {quizError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{quizError}</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Quiz</h2>
                <p className="mt-1 text-sm text-zinc-400">Answers are hidden under each question.</p>
              </div>
            </div>

            {!quiz ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-800 p-6 text-sm text-zinc-400">Generate a quiz to see it here.</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-xs text-zinc-500">Title</div>
                  <div className="mt-1 text-sm font-semibold">{quiz.title || 'Quiz'}</div>
                </div>

                {timed && timeLeftSeconds !== null ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 text-sm">
                    <div className="text-xs text-zinc-500">Time remaining</div>
                    <div className="mt-1 text-lg font-semibold">{formattedTimeLeft}</div>
                    {timeUp ? <div className="mt-1 text-xs text-red-200">Time is up — quiz auto-submitted.</div> : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                    onClick={() => submitQuiz(false)}
                    disabled={!quiz.questions?.length || generating || submitted || submitting || !allAnswered}
                  >
                    {submitting ? 'Submitting…' : 'Submit'}
                  </button>

                  {submitted ? (
                    <button
                      className="rounded-xl border border-zinc-700 bg-zinc-900/30 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-900/50"
                      onClick={() => setShowReview((v) => !v)}
                    >
                      {showReview ? 'Hide review' : 'Review answers'}
                    </button>
                  ) : null}

                  {!submitted ? (
                    <div className="text-xs text-zinc-500">Answer all questions to enable submit.</div>
                  ) : null}
                </div>

                {submitError ? (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{submitError}</div>
                ) : null}

                {submitted && score ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-zinc-100">
                    <div className="font-semibold">Score</div>
                    <div className="mt-1">
                      {score.correct} / {score.total} ({score.percent}%)
                    </div>
                  </div>
                ) : null}

                <div className="space-y-3">
                  {quiz.questions?.map((q, idx) => (
                    <div key={q.id ?? idx} className="rounded-xl border border-zinc-800 bg-zinc-950/10 p-4">
                      <div className="text-sm font-semibold">
                        {idx + 1}. {q.question}
                      </div>
                      {(q.type || 'mcq') === 'mcq' ? (
                        <div className="mt-3 grid gap-2 text-sm">
                          {(q.options || []).map((opt) => {
                            const key = questionKey(q, idx)
                            const picked = responses[key]
                            const isPicked = picked === opt.label
                            const isCorrect = submitted && showReview && opt.label === q.answer
                            const isWrongPicked = submitted && showReview && isPicked && opt.label !== q.answer

                            return (
                              <button
                                key={opt.label}
                                type="button"
                                onClick={() => chooseAnswer(key, opt.label)}
                                disabled={generating || submitted}
                                className={
                                  'rounded-lg border px-3 py-2 text-left text-zinc-100 disabled:opacity-60 ' +
                                  (isCorrect
                                    ? 'border-emerald-500/30 bg-emerald-500/10'
                                    : isWrongPicked
                                    ? 'border-red-500/30 bg-red-500/10'
                                    : isPicked
                                    ? 'border-indigo-500/30 bg-indigo-500/10'
                                    : 'border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/60')
                                }
                              >
                                <span className="font-semibold">{opt.label}.</span> {opt.text}
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="mt-3">
                          <div className="text-xs text-zinc-500">Your answer</div>
                          <textarea
                            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                            rows={4}
                            value={responses[questionKey(q, idx)] || ''}
                            onChange={(e) => chooseAnswer(questionKey(q, idx), e.target.value)}
                            disabled={generating || submitted}
                            placeholder="Type your answer…"
                          />
                        </div>
                      )}

                      {submitted ? (
                        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/20 p-3 text-sm text-zinc-100">
                          <div>
                            Your answer: <span className="font-semibold">{responses[questionKey(q, idx)] || '-'}</span>
                          </div>
                          {showReview ? (
                            <>
                              {(q.type || 'mcq') === 'mcq' ? (
                                <div className="mt-1">
                                  Correct answer: <span className="font-semibold">{q.answer}</span>
                                </div>
                              ) : (
                                <div className="mt-1">
                                  Model answer: <span className="font-semibold">{q.answer_text || '-'}</span>
                                </div>
                              )}
                              {q.explanation ? <div className="mt-2 text-zinc-300">{q.explanation}</div> : null}
                            </>
                          ) : null}
                        </div>
                      ) : null}
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
