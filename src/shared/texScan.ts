import type { CitationSymbol } from './types.ts'

/** Removes a `%` comment from a line, keeping escaped `\%`. */
export function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '%') return line.slice(0, i)
  }
  return line
}

export function findLabels(text: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = []
  text.split('\n').forEach((raw, i) => {
    const line = stripComment(raw)
    for (const m of line.matchAll(/\\label\s*\{([^}]+)\}/g)) out.push({ name: m[1].trim(), line: i + 1 })
  })
  return out
}

export interface OutlineItem {
  /** 0 = part, 1 = chapter, 2 = section, ... 5 = subparagraph. */
  level: number
  title: string
  line: number
}

const SECTION_LEVEL: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
  frametitle: 3
}

/** Reads one balanced `{...}` group starting at `start` (which must be `{`). */
function readGroup(text: string, start: number): { value: string; end: number } | null {
  if (text[start] !== '{') return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return { value: text.slice(start + 1, i), end: i + 1 }
  }
  return null
}

/** Turns LaTeX markup in a heading into readable text, e.g. `\textbf{Bold} title` → `Bold title`. */
export function plainTitle(tex: string): string {
  return tex
    .replace(/\\(?:label|index|footnote)\s*\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z@]+\*?\s*(?:\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findOutline(text: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = text.split('\n')
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|frametitle)\*?\s*(\[[^\]]*\])?\s*\{/g
  lines.forEach((raw, i) => {
    const line = stripComment(raw)
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      // Titles may span lines, so read the group from the rest of the document.
      const rest = [line.slice(m.index + m[0].length - 1), ...lines.slice(i + 1, i + 6)].join('\n')
      const group = readGroup(rest, 0)
      const title = plainTitle(group ? group.value : rest.slice(1, 80))
      items.push({ level: SECTION_LEVEL[m[1]], title: title || '(untitled)', line: i + 1 })
    }
  })
  return items
}

/** Extracts entry keys and a few display fields from a BibTeX/BibLaTeX file. */
export function parseBibEntries(text: string): CitationSymbol[] {
  const out: CitationSymbol[] = []
  const re = /@([a-zA-Z]+)\s*[{(]\s*([^,\s]+)\s*,/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase()
    if (type === 'comment' || type === 'string' || type === 'preamble') continue
    const body = text.slice(m.index + m[0].length, nextEntryStart(text, re.lastIndex))
    out.push({
      key: m[2],
      type,
      title: field(body, 'title'),
      author: field(body, 'author'),
      year: field(body, 'year') ?? field(body, 'date')?.slice(0, 4)
    })
  }
  return out
}

function nextEntryStart(text: string, from: number): number {
  const i = text.indexOf('\n@', from)
  return i === -1 ? text.length : i
}

function field(body: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*`, 'i').exec(body)
  if (!m) return undefined
  const start = m.index + m[0].length
  let value: string
  if (body[start] === '{') value = readGroup(body, start)?.value ?? ''
  else if (body[start] === '"') value = body.slice(start + 1, body.indexOf('"', start + 1))
  else value = /^[^,}\n]*/.exec(body.slice(start))![0]
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() || undefined
}

export interface CompileHints {
  /** `% !TEX root = ...` as written, relative to the file's folder. */
  root?: string
  /** `% !TEX program = ...` */
  engine?: 'pdflatex' | 'xelatex' | 'lualatex'
  /** Loads fontspec, unicode-math or polyglossia, which pdfLaTeX cannot run. */
  needsUnicodeEngine?: boolean
  /** True when the file is a complete document (it has \documentclass). */
  standalone: boolean
}

/** Reads how a .tex file wants to be compiled: magic comments, its own \documentclass, engine-only packages. */
export function compileHints(text: string): CompileHints {
  const head = text.slice(0, 20000)
  const hints: CompileHints = { standalone: false }
  const root = /^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/im.exec(head)?.[1]
  if (root) hints.root = root
  const program = /^\s*%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(\w+)/im.exec(head)?.[1].toLowerCase()
  if (program === 'pdflatex' || program === 'xelatex' || program === 'lualatex') hints.engine = program
  const code = head.split('\n').map(stripComment).join('\n')
  hints.standalone = /\\documentclass\b/.test(code)
  if (/\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\b(?:fontspec|unicode-math|polyglossia)\b/.test(code)) hints.needsUnicodeEngine = true
  return hints
}

const BABEL_LANG: Record<string, string> = {
  english: 'en', american: 'en', usenglish: 'en', british: 'en_GB', ukenglish: 'en_GB', canadian: 'en_CA',
  australian: 'en_AU', newzealand: 'en_NZ', german: 'de', ngerman: 'de', austrian: 'de', naustrian: 'de',
  swissgerman: 'de', nswissgerman: 'de', french: 'fr', francais: 'fr', acadian: 'fr', spanish: 'es',
  italian: 'it', dutch: 'nl', portuguese: 'pt_PT', portuges: 'pt_PT', brazilian: 'pt_BR', brazil: 'pt_BR',
  swedish: 'sv', danish: 'da', norsk: 'nb', norwegian: 'nb', nynorsk: 'nn', finnish: 'fi', polish: 'pl',
  czech: 'cs', russian: 'ru', ukrainian: 'uk', turkish: 'tr', greek: 'el', hungarian: 'hu', magyar: 'hu',
  romanian: 'ro', slovene: 'sl', icelandic: 'is', irish: 'ga', lithuanian: 'lt', bulgarian: 'bg'
}

/**
 * The main language the document declares through babel or polyglossia, as a macOS
 * spell-checker code ("en_GB", "de"), or null when it declares none.
 */
export function documentLanguage(text: string): string | null {
  const end = text.search(/\\begin\s*\{document\}/)
  const pre = (end === -1 ? text.slice(0, 20000) : text.slice(0, end)).split('\n').map(stripComment).join('\n')
  const poly = /\\set(?:default|main)language\s*(?:\[[^\]]*\])?\s*\{\s*(\w+)\s*\}/.exec(pre)?.[1]
  if (poly) return BABEL_LANG[poly.toLowerCase()] ?? null
  const babel = /\\usepackage\s*\[([^\]]*)\]\s*\{babel\}/.exec(pre)?.[1]
  if (!babel) return null
  const options = babel.split(',').map((o) => o.trim())
  // babel's main language is main=..., otherwise the last language option.
  const main = options.find((o) => o.startsWith('main='))?.slice(5).trim()
  const langs = options.filter((o) => !o.includes('=') && o.toLowerCase() in BABEL_LANG)
  const pick = main ?? langs[langs.length - 1]
  return pick ? (BABEL_LANG[pick.toLowerCase()] ?? null) : null
}
