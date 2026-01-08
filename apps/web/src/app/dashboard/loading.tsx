export default function DashboardLoading() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-6 w-48 rounded bg-zinc-800" />
            <div className="h-4 w-80 rounded bg-zinc-700" />
          </div>
          <div className="h-9 w-28 rounded-xl bg-zinc-800" />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="h-56 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="h-4 w-40 rounded bg-zinc-800" />
            <div className="mt-3 h-4 w-64 rounded bg-zinc-700" />
            <div className="mt-6 h-9 w-32 rounded-xl bg-zinc-800" />
          </div>
          <div className="h-56 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="h-4 w-40 rounded bg-zinc-800" />
            <div className="mt-3 h-4 w-64 rounded bg-zinc-700" />
            <div className="mt-6 h-9 w-32 rounded-xl bg-zinc-800" />
          </div>
        </div>
      </div>
    </div>
  )
}
