import Link from 'next/link'

export default function Home() {
  return (
    <div className="h-dvh overflow-hidden bg-zinc-900 p-10 text-zinc-100">
      <div className="mx-auto flex h-full max-w-3xl flex-col justify-center">
        <div className="text-center">
          <h1 className="text-5xl font-semibold tracking-tight">Departmental Study Buddy</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-zinc-300">
            Upload a note, then generate quizzes, flashcards, mind maps, summaries, and highlights.
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Enter the MVP</div>
              <div className="mt-1 text-xs text-zinc-400">Go to the dashboard hub with the sidebar navigation.</div>
            </div>
            <div className="flex gap-2">
              <Link className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-100" href="/login">
                Login
              </Link>
              <Link className="rounded-xl bg-black px-4 py-2 text-sm text-white" href="/dashboard">
                Open Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
