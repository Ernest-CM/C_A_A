'use client'

import { useEffect } from 'react'

export default function ClientRuntimeGuards() {
  useEffect(() => {
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as unknown

      // Seen in some browsers/PDFs/extensions; typically harmless noise.
      if (
        typeof reason === 'object' &&
        reason !== null &&
        'name' in reason &&
        (reason as { name?: unknown }).name === 'AbortError' &&
        'message' in reason &&
        typeof (reason as { message?: unknown }).message === 'string' &&
        (reason as { message: string }).message.includes('play() request was interrupted')
      ) {
        event.preventDefault()
      }
    }

    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }, [])

  return null
}
