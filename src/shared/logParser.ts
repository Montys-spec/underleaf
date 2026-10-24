import type { LogEntry } from './types.ts'

export interface ParseOptions {
  /** Absolute project root, without trailing slash. */
  root: string
  /** Directory of the main file relative to the root ('' for the root itself). */
  mainDir: string
}

// Files that TeX opens appear as `(path` in the log and close with `)`.
const FILE_OPEN = /^(?:\.{1,2}\/|\/)?[^\s()"]*\.[A-Za-z0-9]{1,8}/
const FILE_LINE_ERROR = /^((?:\.{1,2}\/|\/)?[^:\s][^:]*\.[A-Za-z0-9]+):(\d+): (.*)$/
const WARNING = /^(?:LaTeX|Package [^\s]+|Class [^\s]+|pdfTeX|LaTeX Font) Warning: (.*)$/
const BAD_BOX = /^((?:Over|Under)full \\[hv]box .*?)(?: in paragraph| in alignment| detected| has occurred while \\output is active)?(?: at lines? (\d+)(?:--\d+)?)?$/
const INPUT_LINE = /on input line (\d+)/
const CONTEXT_LINE = /^l\.(\d+) ?(.*)$/

type StackEntry = string | null | undefined

/**
 * Parses a TeX log into structured entries. Expects logs written with a large
 * `max_print_line`, but tolerates normal 79-column wrapping reasonably well.
 */
export function parseLatexLog(log: string, opts: ParseOptions): LogEntry[] {
  const lines = log.split(/\r?\n/)
  // undefined: a plain parenthesis; null: a file outside the project; string: project file.
  const stack: StackEntry[] = []
  const entries: LogEntry[] = []

  const currentFile = (): string | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i]
      if (typeof e === 'string') return e
    }
    return undefined
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    const fle = FILE_LINE_ERROR.exec(line)
    if (fle && looksLikeTexSource(fle[1])) {
      const { context, line: ctxLine, consumed } = readErrorContext(lines, i + 1)
      entries.push({
        level: 'error',
        message: cleanMessage(fle[3]),
        file: toProjectPath(fle[1], opts) ?? currentFile(),
        line: Number(fle[2]) || ctxLine,
        context
      })
      i += 1 + consumed
      continue
    }

    if (line.startsWith('! ')) {
      const { context, line: ctxLine, consumed } = readErrorContext(lines, i + 1)
      entries.push({
        level: 'error',
        message: cleanMessage(line.slice(2)),
        file: currentFile(),
        line: ctxLine,
        context
      })
      i += 1 + consumed
      continue
    }

    const warn = WARNING.exec(line)
    if (warn) {
      // Continuation lines are indented to align with the message, or start with `(pkg)`.
      let message = warn[1]
      let j = i + 1
      while (j < lines.length && lines[j].trim() !== '' && /^(\([^)]*\)| {4,})/.test(lines[j])) {
        message += ' ' + lines[j].replace(/^\([^)]*\)/, '').trim()
        j++
      }
      const lineMatch = INPUT_LINE.exec(message)
      entries.push({
        level: 'warning',
        message: cleanMessage(message.replace(/\s*on input line \d+\.?$/, '.')),
        file: currentFile(),
        line: lineMatch ? Number(lineMatch[1]) : undefined
      })
      i = j
      continue
    }

    const box = BAD_BOX.exec(line)
    if (box) {
      entries.push({
        level: 'typesetting',
        message: box[1],
        file: currentFile(),
        line: box[2] ? Number(box[2]) : undefined
      })
      i++
      continue
    }

    scanParens(line, stack, opts)
    i++
  }

  return dedupe(entries)
}

/** Surface problems that never reach the TeX log: missing files, BibTeX and Biber messages. */
export function latexmkEntries(output: string): LogEntry[] {
  const entries: LogEntry[] = []
  for (const raw of output.split('\n')) {
    const line = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /^Latexmk: (.*(?:[Mm]issing input file|[Cc]ould not find|not found|gave an error|[Ff]ailure).*)$/.exec(line))) {
      entries.push({ level: 'error', message: m[1] })
    } else if ((m = /^(?:I couldn't open .*|I found no .*)$/.exec(line))) {
      entries.push({ level: 'error', message: `BibTeX: ${m[0]}` })
    } else if ((m = /^Warning--(.*)$/.exec(line))) {
      entries.push({ level: 'warning', message: `BibTeX: ${m[1]}` })
    } else if ((m = /^(?:INFO|WARN|ERROR) - (.*)$/.exec(line)) && !line.startsWith('INFO')) {
      entries.push({ level: line.startsWith('ERROR') ? 'error' : 'warning', message: `Biber: ${m[1]}` })
    }
  }
  const seen = new Set<string>()
  return entries.filter((e) => !seen.has(e.message) && (seen.add(e.message), true))
}

function readErrorContext(lines: string[], start: number): { context?: string; line?: number; consumed: number } {
  // TeX prints the help text and then a `l.<n> <source excerpt>` line, usually within a few lines.
  const collected: string[] = []
  for (let k = start; k < Math.min(lines.length, start + 12); k++) {
    const l = lines[k]
    if (FILE_LINE_ERROR.test(l) || l.startsWith('! ')) break
    const ctx = CONTEXT_LINE.exec(l)
    collected.push(l)
    if (ctx) {
      // The excerpt continues on the next line (the part after the error point).
      if (k + 1 < lines.length && lines[k + 1].trim() !== '') collected.push(lines[k + 1])
      return { context: collected.join('\n').trim(), line: Number(ctx[1]), consumed: collected.length }
    }
    if (l.trim() === '' && collected.length > 1) break
  }
  return { context: collected.join('\n').trim() || undefined, consumed: 0 }
}

function scanParens(line: string, stack: StackEntry[], opts: ParseOptions): void {
  for (let c = 0; c < line.length; c++) {
    const ch = line[c]
    if (ch === '(') {
      const m = FILE_OPEN.exec(line.slice(c + 1))
      if (m && (m[0].includes('/') || /\.(tex|sty|cls|cfg|def|clo|fd|aux|bbl|toc|ltx|ldf|out|lof|lot|nav|snm|bib|code\.tex)$/.test(m[0]))) {
        stack.push(toProjectPath(m[0], opts) ?? null)
        c += m[0].length
      } else {
        stack.push(undefined)
      }
    } else if (ch === ')') {
      stack.pop()
    }
  }
}

function looksLikeTexSource(p: string): boolean {
  return /\.(tex|sty|cls|bib|ltx|dtx|bbl|aux|def|cfg)$/i.test(p)
}

/** Converts a path seen in the log to a project-relative path, or undefined if it is outside. */
export function toProjectPath(p: string, opts: ParseOptions): string | undefined {
  let full: string
  if (p.startsWith('/')) {
    full = p
  } else {
    full = joinPosix(opts.root, opts.mainDir, p)
  }
  full = normalizePosix(full)
  const root = normalizePosix(opts.root)
  if (full === root || !full.startsWith(root + '/')) return undefined
  const rel = full.slice(root.length + 1)
  // Build products live in .underleaf/ and are not user files.
  if (rel.startsWith('.underleaf/')) return undefined
  return rel
}

function joinPosix(...parts: string[]): string {
  return parts.filter((s) => s !== '').join('/')
}

function normalizePosix(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}

function cleanMessage(m: string): string {
  return m.replace(/\s+/g, ' ').trim()
}

function dedupe(entries: LogEntry[]): LogEntry[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    const key = `${e.level}|${e.file}|${e.line}|${e.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
