'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { clearAccessToken } from '@/lib/authToken'

type NavItem = {
  href: string
  label: string
  icon: (props: { className?: string }) => React.ReactNode
}

function IconUpload({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 15V4m0 0 3.5 3.5M12 4 8.5 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconQuiz({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 7.5A4.5 4.5 0 0 1 11.5 3h1A4.5 4.5 0 0 1 17 7.5c0 3-3 3-3 5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M12 18.5h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function IconCards({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 7h10a2 2 0 0 1 2 2v10H9a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M5 17V7a2 2 0 0 1 2-2h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconMindmap({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 6a2 2 0 1 0 0.001 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M6 18a2 2 0 1 0 0.001 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M18 18a2 2 0 1 0 0.001 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 8v3m0 0-6 5m6-5 6 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconHighlighter({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 14 16.5 4.5a2.1 2.1 0 0 1 3 3L10 17H7v-3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M7 20h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconLab({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 2v6l-5.2 9a3 3 0 0 0 2.6 4.5h9.2a3 3 0 0 0 2.6-4.5L16 8V2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 12h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconHome({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconLogout({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M3 12h10m0 0-3-3m3 3-3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const items: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: IconHome },
  { href: '/dashboard/files', label: 'Uploads', icon: IconUpload },
  { href: '/dashboard/quiz', label: 'Quiz', icon: IconQuiz },
  { href: '/dashboard/flashcards', label: 'Flashcards', icon: IconCards },
  { href: '/dashboard/mindmaps', label: 'Mind maps', icon: IconMindmap },
  { href: '/dashboard/highlighter', label: 'Highlighter', icon: IconHighlighter },
  { href: '/dashboard/lab', label: 'Lab', icon: IconLab },
]

export default function SidebarNav() {
  const pathname = usePathname()
  const router = useRouter()
  const enablePrefetch = process.env.NODE_ENV !== 'development'

  function signOut() {
    clearAccessToken()
    router.replace('/login')
  }

  return (
    <div className="flex h-full flex-col items-center justify-between py-4">
      <div className="flex flex-col items-center gap-3">
        <Link
          href="/dashboard"
          prefetch={enablePrefetch}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900"
          aria-label="Dashboard home"
          title="Dashboard"
        >
          <span className="text-xs font-semibold text-zinc-100">DSB</span>
        </Link>

        <nav className="flex flex-col items-center gap-2">
          {items.map((it) => {
            const active = pathname === it.href
            const Icon = it.icon
            return (
              <Link
                key={it.href}
                href={it.href}
                prefetch={enablePrefetch}
                className={
                  'flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ' +
                  (active
                    ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-100 hover:bg-zinc-800')
                }
                title={it.label}
                aria-label={it.label}
              >
                <Icon className="h-[18px] w-[18px]" />
              </Link>
            )
          })}
        </nav>
      </div>

      <button
        type="button"
        onClick={signOut}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
        title="Sign out"
        aria-label="Sign out"
      >
        <IconLogout className="h-[18px] w-[18px]" />
      </button>
    </div>
  )
}
