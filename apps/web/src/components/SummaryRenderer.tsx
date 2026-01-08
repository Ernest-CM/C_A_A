import React from 'react'

type Segment =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }

function isBulletLine(line: string): boolean {
  return /^\s*(?:[-*•]|\d+\.)\s+\S+/.test(line)
}

function isImplicitBoldColonBullet(line: string): boolean {
  // Example: **Key point**: explanation...
  return /^\s*\*\*[^*]+\*\*\s*:\s*\S+/.test(line)
}

function normalizeBullet(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+\.)\s+/, '').trim()
}

function parseSummary(text: string): Segment[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const segments: Segment[] = []

  let currentPara: string[] = []
  let currentUl: string[] = []

  const flushPara = () => {
    const joined = currentPara.join(' ').replace(/\s+/g, ' ').trim()
    if (joined) segments.push({ type: 'p', text: joined })
    currentPara = []
  }

  const flushUl = () => {
    const items = currentUl.map((s) => s.trim()).filter(Boolean)
    if (items.length) segments.push({ type: 'ul', items })
    currentUl = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (!line.trim()) {
      flushPara()
      flushUl()
      continue
    }

    if (isBulletLine(line) || isImplicitBoldColonBullet(line)) {
      flushPara()
      const item = isBulletLine(line) ? normalizeBullet(line) : line.trim()
      if (item) currentUl.push(item)
      continue
    }

    flushUl()
    currentPara.push(line.trim())
  }

  flushPara()
  flushUl()

  if (!segments.length) return [{ type: 'p', text: text.trim() }]
  return segments
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  // Minimal, safe renderer for **bold**. No HTML injection.
  const out: React.ReactNode[] = []

  let i = 0
  while (i < text.length) {
    const start = text.indexOf('**', i)
    if (start === -1) {
      out.push(text.slice(i))
      break
    }

    // push leading plain text
    if (start > i) out.push(text.slice(i, start))

    const end = text.indexOf('**', start + 2)
    if (end === -1) {
      // unmatched; treat as literal
      out.push(text.slice(start))
      break
    }

    const boldText = text.slice(start + 2, end)
    out.push(
      <strong key={`b-${start}-${end}`} className="font-semibold text-zinc-50">
        {boldText}
      </strong>,
    )
    i = end + 2
  }

  return out
}

export function SummaryRenderer({ text }: { text: string }) {
  const segments = React.useMemo(() => parseSummary(text), [text])

  return (
    <div className="font-sans text-sm leading-6 text-zinc-200">
      {segments.map((seg, idx) => {
        if (seg.type === 'ul') {
          return (
            <ul key={idx} className="my-2 list-disc space-y-1 pl-5">
              {seg.items.map((item, j) => (
                <li key={j} className="text-zinc-200">
                  {renderInlineMarkdown(item)}
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p key={idx} className="my-2">
            {renderInlineMarkdown(seg.text)}
          </p>
        )
      })}
    </div>
  )
}
