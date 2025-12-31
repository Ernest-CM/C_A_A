import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-2xl rounded-2xl border bg-white p-8">
        <h1 className="text-3xl font-semibold">Departmental Study Buddy</h1>
        <p className="mt-2 text-zinc-600">
          Block 1 is live: upload notes (PDF/images), extract text, view and delete.
        </p>
        <div className="mt-6 flex gap-3">
          <Link className="rounded-xl bg-black px-4 py-2 text-white" href="/login">
            Login
          </Link>
          <Link className="rounded-xl border px-4 py-2" href="/dashboard/files">
            Go to Uploads
          </Link>
        </div>
      </div>
    </div>
  )
}
