/**
 * Finds the LaTeX structures the visual editor renders (headings, formatting,
 * math, lists, figures, tables, references) with their exact source ranges.
 * It is a forgiving scanner, not a TeX implementation: anything it does not
 * recognise is simply left as source.
 */

export type FormatStyle = 'bold' | 'italic' | 'emph' | 'underline' | 'mono' | 'smallcaps' | 'sans' | 'strike'
export type ListKind = 'itemize' | 'enumerate' | 'description'

export type VNode =
  | { kind: 'section'; level: number; from: number; to: number; contentFrom: number; contentTo: number }
  | { kind: 'format'; style: FormatStyle; from: number; to: number; contentFrom: number; contentTo: number }
  | { kind: 'footnote'; from: number; to: number; contentFrom: number; contentTo: number }
  | { kind: 'caption'; from: number; to: number; contentFrom: number; contentTo: number }
  | { kind: 'link'; from: number; to: number; url: string; contentFrom: number; contentTo: number }
  | { kind: 'ref'; command: string; from: number; to: number; keys: string[] }
  | { kind: 'cite'; command: string; from: number; to: number; keys: string[] }
  | { kind: 'label'; from: number; to: number; name: string }
  | { kind: 'symbol'; from: number; to: number; text: string }
  | { kind: 'math'; display: boolean; from: number; to: number; tex: string }
  | { kind: 'graphic'; from: number; to: number; path: string; options: string }
  /** depth counts all enclosing lists (for indentation); level counts lists of the same kind (for numbering). */
  | { kind: 'item'; from: number; to: number; list: ListKind; index: number; depth: number; level: number; label?: string }
  | { kind: 'begin' | 'end'; name: string; from: number; to: number; title?: string; list?: boolean }
  | { kind: 'float'; name: string; from: number; to: number; bodyFrom: number; bodyTo: number }
  | { kind: 'table'; from: number; to: number; rows: TableRow[] }
  | { kind: 'maketitle'; from: number; to: number }

export interface TableCell {
  tex: string
  span: number
  /** Alignment from \multicolumn's column spec, when given. */
  align?: 'left' | 'center' | 'right'
}

export interface TableRow {
  cells: TableCell[]
  /** A horizontal rule is drawn above this row. */
  ruleAbove: boolean
}

export interface VisualDoc {
  nodes: VNode[]
  /** Everything up to and including `\begin{document}`, when the file has a preamble. */
  preamble: { from: number; to: number } | null
  title?: string
  author?: string
  date?: string
  /** Math macros from \newcommand and \DeclareMathOperator, for KaTeX. */
  macros: Record<string, string>
  /** \graphicspath entries, relative to the document. */
  graphicsPaths: string[]
}

const SECTION_LEVEL: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6
}

const FORMAT: Record<string, FormatStyle> = {
  textbf: 'bold',
  textit: 'italic',
  textsl: 'italic',
  emph: 'emph',
  underline: 'underline',
  uline: 'underline',
  texttt: 'mono',
  textsc: 'smallcaps',
  textsf: 'sans',
  sout: 'strike'
}

const REF = new Set(['ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'nameref', 'vref', 'labelcref'])
const CITE = new Set(['cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'textcite', 'parencite', 'autocite', 'footcite', 'nocite', 'fullcite', 'Cite', 'Textcite', 'Parencite', 'Autocite'])
const MATH_ENVS = new Set(['equation', 'align', 'gather', 'multline', 'eqnarray', 'flalign', 'alignat', 'displaymath', 'math', 'dmath'])
const VERBATIM_ENVS = new Set(['verbatim', 'Verbatim', 'lstlisting', 'minted', 'comment', 'filecontents'])
const TABULAR_ENVS = new Set(['tabular', 'tabular*', 'tabularx', 'tabulary', 'longtable'])
const FLOAT_ENVS = new Set(['figure', 'figure*', 'table', 'table*', 'wrapfigure', 'sidewaysfigure', 'sidewaystable'])
const LISTS = new Set<string>(['itemize', 'enumerate', 'description'])

const SYMBOLS: Record<string, string> = {
  LaTeX: 'LaTeX',
  LaTeXe: 'LaTeX2ε',
  TeX: 'TeX',
  ldots: '…',
  dots: '…',
  textbackslash: '\\',
  textasciitilde: '~',
  textendash: '–',
  textemdash: '—',
  copyright: '©',
  textregistered: '®',
  texttrademark: '™',
  S: '§',
  P: '¶',
  ss: 'ß',
  o: 'ø',
  O: 'Ø',
  aa: 'å',
  AA: 'Å',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  euro: '€',
  pounds: '£'
}

/** Index just past a balanced group starting at `start` (which must hold `open`), or -1. */
export function groupEnd(text: string, start: number, open = '{', close = '}'): number {
  if (text[start] !== open) return -1
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '%') {
      const nl = text.indexOf('\n', i)
      if (nl === -1) return -1
      i = nl
      continue
    }
    if (c === open) depth++
    else if (c === close && --depth === 0) return i + 1
  }
  return -1
}

interface Args {
  options: { from: number; to: number }[]
  args: { from: number; to: number }[]
  end: number
}

/**
 * Reads `[opt]` groups and `count` brace groups after a command name. Ranges are the
 * contents inside the brackets. Returns null when a required group is missing.
 */
function readArgs(text: string, pos: number, count: number, maxOptions = 2): Args | null {
  const out: Args = { options: [], args: [], end: pos }
  let i = pos
  const skipSpace = () => {
    // Arguments may follow on the next line, but never across a blank line.
    let newlines = 0
    while (i < text.length && /\s/.test(text[i])) {
      if (text[i] === '\n' && ++newlines > 1) return
      i++
    }
  }
  skipSpace()
  while (out.options.length < maxOptions && text[i] === '[' && out.args.length === 0) {
    const e = groupEnd(text, i, '[', ']')
    if (e === -1) return null
    out.options.push({ from: i + 1, to: e - 1 })
    i = e
    skipSpace()
  }
  for (let k = 0; k < count; k++) {
    if (k > 0) skipSpace()
    if (text[i] !== '{') return null
    const e = groupEnd(text, i)
    if (e === -1) return null
    out.args.push({ from: i + 1, to: e - 1 })
    i = e
  }
  out.end = i
  return out
}

function findEnd(text: string, name: string, from: number): { from: number; to: number } | null {
  const token = `\\end{${name}}`
  const at = text.indexOf(token, from)
  return at === -1 ? null : { from: at, to: at + token.length }
}

function lineEnd(text: string, i: number): number {
  const nl = text.indexOf('\n', i)
  return nl === -1 ? text.length : nl
}

/** Removes the bits of a math environment KaTeX does not understand. */
export function cleanMath(tex: string): string {
  return tex
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    .replace(/(^|[^\\])%[^\n]*/g, '$1')
    .trim()
}

function parsePreamble(text: string, doc: VisualDoc, from: number, to: number): void {
  const pre = text.slice(from, to)
  const grab = (cmd: string): string | undefined => {
    const m = new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\])?\\s*\\{`).exec(pre)
    if (!m) return undefined
    const start = m.index + m[0].length - 1
    const e = groupEnd(pre, start)
    return e === -1 ? undefined : pre.slice(start + 1, e - 1).trim()
  }
  doc.title ??= grab('title')
  doc.author ??= grab('author')
  doc.date ??= grab('date')

  // \newcommand{\R}{\mathbb{R}}, \newcommand\R{...}, \renewcommand, \def\R{...}
  const macro = /\\(?:re)?newcommand\*?\s*\{?\s*(\\[A-Za-z@]+)\s*\}?\s*(?:\[(\d)\])?\s*(?:\[[^\]]*\])?\s*\{|\\def\s*(\\[A-Za-z@]+)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = macro.exec(pre))) {
    const start = m.index + m[0].length - 1
    const e = groupEnd(pre, start)
    if (e === -1) continue
    doc.macros[m[1] ?? m[3]] = pre.slice(start + 1, e - 1)
  }
  const op = /\\DeclareMathOperator(\*?)\s*\{\s*(\\[A-Za-z]+)\s*\}\s*\{([^}]*)\}/g
  while ((m = op.exec(pre))) doc.macros[m[2]] = m[1] ? `\\operatorname*{${m[3]}}` : `\\operatorname{${m[3]}}`

  const gp = /\\graphicspath\s*\{((?:\s*\{[^}]*\}\s*)*)\}/.exec(pre)
  if (gp) doc.graphicsPaths = [...gp[1].matchAll(/\{([^}]*)\}/g)].map((x) => x[1])
}

function parseTable(body: string): TableRow[] {
  // Drop comments, then split rows on \\ at brace depth 0.
  const clean = body.replace(/(^|[^\\])%[^\n]*/g, '$1')
  const rows: TableRow[] = []
  let depth = 0
  let cur = ''
  const parts: string[] = []
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (c === '\\' && clean[i + 1] === '\\' && depth === 0) {
      parts.push(cur)
      cur = ''
      i++
      // Skip an optional row spacing argument: \\[2pt]
      const rest = clean.slice(i + 1)
      const sp = /^\s*\[[^\]]*\]/.exec(rest)
      if (sp) i += sp[0].length
      continue
    }
    if (c === '\\') {
      cur += c + (clean[i + 1] ?? '')
      i++
      continue
    }
    if (c === '{') depth++
    if (c === '}') depth--
    cur += c
  }
  parts.push(cur)

  let pendingRule = false
  for (const raw of parts) {
    let part = raw
    // Rules may appear before the first cell of a row.
    const rule = /^\s*(?:\\(?:hline|toprule|midrule|bottomrule|endhead|endfirsthead|endfoot|endlastfoot)\b(?:\[[^\]]*\])?|\\(?:cline|cmidrule)(?:\([^)]*\))?\{[^}]*\})\s*/
    let r: RegExpExecArray | null
    while ((r = rule.exec(part))) {
      if (!/endhead|endfoot|endfirsthead|endlastfoot/.test(r[0])) pendingRule = true
      part = part.slice(r[0].length)
    }
    if (part.trim() === '') continue
    const cells: TableCell[] = []
    let d = 0
    let cell = ''
    for (let i = 0; i < part.length; i++) {
      const c = part[i]
      if (c === '\\') {
        cell += c + (part[i + 1] ?? '')
        i++
        continue
      }
      if (c === '{') d++
      if (c === '}') d--
      if (c === '&' && d === 0) {
        cells.push(toCell(cell))
        cell = ''
      } else cell += c
    }
    cells.push(toCell(cell))
    rows.push({ cells, ruleAbove: pendingRule })
    pendingRule = false
  }
  // A rule after the last row is drawn as the table's bottom border.
  if (pendingRule && rows.length) rows.push({ cells: [], ruleAbove: true })
  return rows
}

function toCell(raw: string): TableCell {
  const tex = raw.trim()
  const mc = /^\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*\{([\s\S]*)\}$/.exec(tex)
  if (mc) {
    const spec = mc[2].replace(/[|\s]/g, '')
    const align = spec.startsWith('c') ? 'center' : spec.startsWith('r') ? 'right' : spec.startsWith('l') ? 'left' : undefined
    return { tex: mc[3].trim(), span: Number(mc[1]), align }
  }
  return { tex, span: 1 }
}

export function parseVisual(text: string): VisualDoc {
  const doc: VisualDoc = { nodes: [], preamble: null, macros: {}, graphicsPaths: [] }
  const nodes = doc.nodes
  const n = text.length

  let start = 0
  const beginDoc = /^[^%\n]*?(\\begin\s*\{document\})/m.exec(text)
  if (beginDoc) {
    const at = beginDoc.index + beginDoc[0].length - beginDoc[1].length
    const to = at + beginDoc[1].length
    doc.preamble = { from: 0, to }
    parsePreamble(text, doc, 0, at)
    start = to
  } else {
    parsePreamble(text, doc, 0, n)
  }

  const lists: { kind: ListKind; count: number }[] = []
  const floats: { name: string; from: number; bodyFrom: number }[] = []

  let i = start
  while (i < n) {
    const c = text[i]

    if (c === '%') {
      i = lineEnd(text, i)
      continue
    }

    if (c === '$') {
      const display = text[i + 1] === '$'
      const open = display ? 2 : 1
      let j = i + open
      while (j < n) {
        if (text[j] === '\\') j += 2
        else if (text[j] === '$') break
        else if (!display && text[j] === '\n' && text[j + 1] === '\n') break
        else j++
      }
      if (j < n && text[j] === '$' && (!display || text[j + 1] === '$')) {
        const to = j + open
        nodes.push({ kind: 'math', display, from: i, to, tex: cleanMath(text.slice(i + open, j)) })
        i = to
      } else i += open
      continue
    }

    if (c === '\\') {
      const next = text[i + 1]
      if (next === '(' || next === '[') {
        const close = next === '(' ? '\\)' : '\\]'
        const e = text.indexOf(close, i + 2)
        if (e !== -1) {
          nodes.push({ kind: 'math', display: next === '[', from: i, to: e + 2, tex: cleanMath(text.slice(i + 2, e)) })
          i = e + 2
        } else i += 2
        continue
      }
      const name = /^[A-Za-z@]+\*?/.exec(text.slice(i + 1, i + 40))?.[0]
      if (!name) {
        if (next && '%&#$_{}'.includes(next)) nodes.push({ kind: 'symbol', from: i, to: i + 2, text: next })
        i += 2
        continue
      }
      const base = name.replace(/\*$/, '')
      const after = i + 1 + name.length

      if (base in SECTION_LEVEL) {
        const a = readArgs(text, after, 1, 1)
        if (a) {
          nodes.push({ kind: 'section', level: SECTION_LEVEL[base], from: i, to: a.end, contentFrom: a.args[0].from, contentTo: a.args[0].to })
          i = a.args[0].from
          continue
        }
      } else if (base in FORMAT) {
        const a = readArgs(text, after, 1, 0)
        if (a) {
          nodes.push({ kind: 'format', style: FORMAT[base], from: i, to: a.end, contentFrom: a.args[0].from, contentTo: a.args[0].to })
          i = a.args[0].from
          continue
        }
      } else if (base === 'footnote' || base === 'caption') {
        const a = readArgs(text, after, 1, 1)
        if (a) {
          nodes.push({ kind: base, from: i, to: a.end, contentFrom: a.args[0].from, contentTo: a.args[0].to })
          i = a.args[0].from
          continue
        }
      } else if (base === 'href') {
        const a = readArgs(text, after, 2, 1)
        if (a) {
          const [url, label] = a.args
          nodes.push({ kind: 'link', from: i, to: a.end, url: text.slice(url.from, url.to), contentFrom: label.from, contentTo: label.to })
          i = label.from
          continue
        }
      } else if (base === 'url') {
        const a = readArgs(text, after, 1, 0)
        if (a) {
          const u = a.args[0]
          nodes.push({ kind: 'link', from: i, to: a.end, url: text.slice(u.from, u.to), contentFrom: u.from, contentTo: u.to })
          i = a.end
          continue
        }
      } else if (REF.has(base) || CITE.has(base)) {
        const a = readArgs(text, after, 1, 2)
        if (a) {
          const keys = text.slice(a.args[0].from, a.args[0].to).split(',').map((k) => k.trim()).filter(Boolean)
          nodes.push({ kind: REF.has(base) ? 'ref' : 'cite', command: base, from: i, to: a.end, keys })
          i = a.end
          continue
        }
      } else if (base === 'label') {
        const a = readArgs(text, after, 1, 0)
        if (a) {
          nodes.push({ kind: 'label', from: i, to: a.end, name: text.slice(a.args[0].from, a.args[0].to).trim() })
          i = a.end
          continue
        }
      } else if (base === 'includegraphics') {
        const a = readArgs(text, after, 1, 2)
        if (a) {
          nodes.push({
            kind: 'graphic',
            from: i,
            to: a.end,
            path: text.slice(a.args[0].from, a.args[0].to).trim(),
            options: a.options.map((o) => text.slice(o.from, o.to)).join(',')
          })
          i = a.end
          continue
        }
      } else if (base === 'maketitle') {
        nodes.push({ kind: 'maketitle', from: i, to: after })
        i = after
        continue
      } else if (base === 'title' || base === 'author' || base === 'date') {
        // Title data may also be set after \begin{document}.
        const a = readArgs(text, after, 1, 1)
        if (a) doc[base] = text.slice(a.args[0].from, a.args[0].to).trim()
      } else if (base === 'item' && lists.length) {
        const list = lists[lists.length - 1]
        list.count++
        let to = after
        let label: string | undefined
        const opt = /^\s*\[/.exec(text.slice(after, after + 20))
        if (opt) {
          const e = groupEnd(text, after + opt[0].length - 1, '[', ']')
          if (e !== -1) {
            label = text.slice(after + opt[0].length, e - 1)
            to = e
          }
        }
        // The marker swallows one following space, so the text starts where the bullet is.
        if (text[to] === ' ') to++
        const level = lists.filter((l) => l.kind === list.kind).length
        nodes.push({ kind: 'item', from: i, to, list: list.kind, index: list.count, depth: lists.length, level, label })
        i = to
        continue
      } else if (base === 'begin' || base === 'end') {
        const a = readArgs(text, after, 1, 0)
        if (a) {
          const env = text.slice(a.args[0].from, a.args[0].to).trim()
          const envBase = env.replace(/\*$/, '')
          if (base === 'begin') {
            if (MATH_ENVS.has(envBase)) {
              const end = findEnd(text, env, a.end)
              if (end) {
                const body = text.slice(a.end, end.from)
                const tex = envBase === 'equation' || envBase === 'displaymath' || envBase === 'math' || envBase === 'dmath'
                  ? cleanMath(body)
                  : // Multi-line environments render through KaTeX's aligned/gathered equivalents.
                    `\\begin{${envBase === 'gather' ? 'gathered' : 'aligned'}}${cleanMath(body.replace(/^\s*\{[^}]*\}/, ''))}\\end{${envBase === 'gather' ? 'gathered' : 'aligned'}}`
                nodes.push({ kind: 'math', display: envBase !== 'math', from: i, to: end.to, tex })
                i = end.to
                continue
              }
            }
            if (VERBATIM_ENVS.has(envBase)) {
              const end = findEnd(text, env, a.end)
              i = end ? end.to : n
              continue
            }
            if (TABULAR_ENVS.has(env)) {
              // \begin{tabular}{lcr}, \begin{tabular*}{width}{spec}, \begin{tabularx}{width}{spec}
              const specArgs = readArgs(text, a.end, env === 'tabular' || env === 'longtable' ? 1 : 2, 1)
              const bodyFrom = specArgs ? specArgs.end : a.end
              const end = findEnd(text, env, bodyFrom)
              if (end) {
                nodes.push({ kind: 'table', from: i, to: end.to, rows: parseTable(text.slice(bodyFrom, end.from)) })
                i = end.to
                continue
              }
            }
            if (env === 'document') {
              i = a.end
              continue
            }
            const isList = LISTS.has(envBase)
            if (isList) lists.push({ kind: envBase as ListKind, count: 0 })
            if (FLOAT_ENVS.has(env)) floats.push({ name: env, from: i, bodyFrom: a.end })
            // Theorem-like environments take an optional title: \begin{theorem}[Pythagoras]
            let to = a.end
            let title: string | undefined
            if (!isList && text[to] === '[') {
              const e = groupEnd(text, to, '[', ']')
              if (e !== -1) {
                title = text.slice(to + 1, e - 1)
                to = e
              }
            }
            nodes.push({ kind: 'begin', name: env, from: i, to, title, list: isList })
            i = to
            continue
          } else {
            if (env === 'document') {
              nodes.push({ kind: 'end', name: env, from: i, to: a.end })
              i = a.end
              continue
            }
            const isList = LISTS.has(envBase)
            if (isList) lists.pop()
            const fl = floats.length && floats[floats.length - 1].name === env ? floats.pop() : undefined
            if (fl) nodes.push({ kind: 'float', name: env, from: fl.from, to: a.end, bodyFrom: fl.bodyFrom, bodyTo: i })
            nodes.push({ kind: 'end', name: env, from: i, to: a.end, list: isList })
            i = a.end
            continue
          }
        }
      } else if (base in SYMBOLS) {
        // \LaTeX{} and \LaTeX\ both end the macro.
        let to = after
        if (text.startsWith('{}', to)) to += 2
        nodes.push({ kind: 'symbol', from: i, to, text: SYMBOLS[base] })
        i = to
        continue
      }
      i = after
      continue
    }

    if (c === '~') {
      nodes.push({ kind: 'symbol', from: i, to: i + 1, text: ' ' })
    } else if (c === '-' && text[i + 1] === '-') {
      const em = text[i + 2] === '-'
      nodes.push({ kind: 'symbol', from: i, to: i + (em ? 3 : 2), text: em ? '—' : '–' })
      i += em ? 3 : 2
      continue
    } else if ((c === '`' && text[i + 1] === '`') || (c === "'" && text[i + 1] === "'")) {
      nodes.push({ kind: 'symbol', from: i, to: i + 2, text: c === '`' ? '“' : '”' })
      i += 2
      continue
    }
    i++
  }

  // Floats are emitted when they close; keep the list in document order.
  nodes.sort((a, b) => a.from - b.from || b.to - a.to)
  return doc
}
