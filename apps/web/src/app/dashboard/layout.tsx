import type { ReactNode } from 'react'

import SidebarNav from './SidebarNav'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-zinc-900 text-zinc-100">
      <div className="flex min-h-dvh">
        <aside className="w-[72px] shrink-0 border-r border-zinc-800 bg-zinc-900">
          <SidebarNav />
        </aside>
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
