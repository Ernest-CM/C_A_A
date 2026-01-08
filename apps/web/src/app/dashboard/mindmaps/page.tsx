import { Suspense } from 'react'

import MindmapsClient from './MindmapsClient'

export default async function MindmapsPage({
  searchParams,
}: {
  searchParams?: Promise<{ fileId?: string }>
}) {
  const sp = (await searchParams) || {}

  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading…</div>}>
      <MindmapsClient initialFileId={sp.fileId || ''} />
    </Suspense>
  )
}
