import {
  DOCUMENT_RULE_VERSION, FIRECRAWL_INTRO_URL,
  type DocumentAssessment, type DocumentFields, type DocumentField, type DocumentDiff,
  type FieldEvidence, type FetchResult,
} from '@w2l/contracts'

/** This adapter validates a bounded document schema, not arbitrary page truth. */
export function assessFirecrawlIntroduction(result: FetchResult | null): DocumentAssessment {
  const fail = (quality: DocumentAssessment['quality'], ...reasons: string[]): DocumentAssessment =>
    ({ quality, reasons, ruleVersion: DOCUMENT_RULE_VERSION, fields: null, evidence: [] })
  if (result === null) return fail('unknown', 'capture_failed')
  if (result.status !== 'success') return fail(result.status === 'partial' ? 'partial' : 'unknown', `capture_${result.status}`)
  if (result.truncated) return fail('partial', 'truncated')
  if (result.evidence.httpStatus !== 200) return fail('invalid', 'unexpected_http_status')
  try {
    const actual = new URL(result.evidence.finalUrl)
    const expected = new URL(FIRECRAWL_INTRO_URL)
    if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== '') {
      return fail('invalid', 'wrong_document')
    }
  } catch { return fail('invalid', 'invalid_source_url') }
  const markdown = result.markdown
  if (markdown === null || !markdown.trim()) return fail('unknown', 'empty_content')
  const markdownText = markdown

  // Track offsets in the delivered Markdown; ignore headings inside fenced code.
  const headings: { level: number; title: string; anchor: string | null; start: number; end: number }[] = []
  let fence: string | null = null
  let offset = 0
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
    } else if (!fence) {
      const match = /^(#{1,3})\s+(.+)$/.exec(line)
      if (match) {
        const text = match[2]!
        const anchor = /\[[^\]]*\]\(#([^)]*)\)/.exec(text)?.[1] ?? null
        const title = text.replace(/\[[^\]]*\]\(#[^)]*\)/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
        headings.push({ level: match[1]!.length, title, anchor, start: offset, end: offset + line.length })
      }
    }
    offset += line.length + 1
  }
  const titles = headings.filter((h) => h.level === 1)
  if (titles.length !== 1 || titles[0]!.title !== 'Introduction') return fail('invalid', 'document_title_mismatch')
  const title = titles[0]!
  const evidence: FieldEvidence[] = [{ field: 'title', start: title.start, end: title.end, quote: markdownText.slice(title.start, title.end) }]
  function proseAfter(heading: typeof title, field: DocumentField): string | null {
    const end = headings.find((h) => h.start > heading.start)?.start ?? markdownText.length
    const block = markdownText.slice(heading.end, end)
    const leading = /^\s*/.exec(block)![0].length
    const first = block.slice(leading).split(/\n\s*\n|\n\s*```|\n\s*~~~/)[0]?.trim() ?? ''
    if (first.length < 30 || first.startsWith('```') || first.startsWith('<')) return null
    const start = heading.end + leading
    const quote = markdownText.slice(start, start + first.length)
    evidence.push({ field, start, end: start + first.length, quote })
    // Prose-only normalization. Code blocks never enter this field schema.
    return quote.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()
  }
  const introduction = proseAfter(title, 'introduction')
  if (!introduction || !/\bFirecrawl\b/.test(introduction)) return fail('invalid', 'missing_subject_introduction')
  const fields: Partial<DocumentFields> = { title: title.title, introduction }
  const reasons: string[] = []
  for (const capability of ['search', 'scrape', 'interact'] as const) {
    const field = `${capability}Description` as DocumentField
    const candidates = headings.filter((h) => h.level === 2 && h.anchor === capability && h.title.toLowerCase() === capability)
    // Plain Markdown is supported only if the heading is unique (no card ambiguity).
    const matches = candidates.length ? candidates : headings.filter((h) => h.level === 2 && h.title.toLowerCase() === capability)
    const value = matches.length === 1 ? proseAfter(matches[0]!, field) : null
    if (!value) reasons.push(`missing_or_ambiguous_${capability}_section`)
    else fields[field] = value
  }
  const quality = reasons.length === 3 ? 'invalid' : reasons.length ? 'partial' : 'valid'
  return { quality, reasons, ruleVersion: DOCUMENT_RULE_VERSION,
    fields: reasons.length ? null : fields as DocumentFields, evidence }
}

export function diffDocument(before: DocumentFields, after: DocumentFields): DocumentDiff[] {
  return (Object.keys(before) as DocumentField[]).filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }))
}
