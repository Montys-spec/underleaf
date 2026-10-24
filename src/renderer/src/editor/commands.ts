import { startCompletion } from '@codemirror/autocomplete'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * Formatting actions for the editor toolbar. They edit LaTeX source, so they work the
 * same in the code and visual editors.
 */

/** Wraps the selection in \cmd{...}, or removes the command if the cursor is already inside one. */
export function toggleCommand(view: EditorView, cmd: string): void {
  const { state } = view
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const re = new RegExp(`\\\\${cmd}\\{([^{}]*)\\}`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(line.text))) {
    const start = line.from + m.index
    const end = start + m[0].length
    if (range.from >= start && range.to <= end) {
      const inner = m[1]
      view.dispatch({
        changes: { from: start, to: end, insert: inner },
        selection: EditorSelection.range(start, start + inner.length)
      })
      view.focus()
      return
    }
  }
  view.dispatch(
    state.changeByRange((r) => {
      const text = state.sliceDoc(r.from, r.to)
      const insert = `\\${cmd}{${text}}`
      const start = r.from + cmd.length + 2
      return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(start, start + text.length) }
    })
  )
  view.focus()
}

export const HEADINGS = [
  { value: '', label: 'Normal text' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'section', label: 'Section' },
  { value: 'subsection', label: 'Subsection' },
  { value: 'subsubsection', label: 'Subsubsection' },
  { value: 'paragraph', label: 'Paragraph' }
]

const HEADING_RE = /^(\s*)\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*\{(.*)\}(.*)$/

/** The heading command on the cursor's line, or '' for normal text. */
export function currentHeading(view: EditorView): string {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return HEADING_RE.exec(line.text)?.[2] ?? ''
}

/** Turns the cursor's line into a heading of the given kind, or back into normal text. */
export function setHeading(view: EditorView, cmd: string): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const m = HEADING_RE.exec(line.text)
  let insert: string
  if (m) insert = cmd ? `${m[1]}\\${cmd}${m[3]}{${m[4]}}${m[5]}` : `${m[1]}${m[4]}${m[5]}`
  else if (cmd) {
    const indent = /^\s*/.exec(line.text)![0]
    insert = `${indent}\\${cmd}{${line.text.trim() || 'Title'}}`
  } else return
  view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length - (m?.[5].length ?? 0) - 1 } })
  view.focus()
}

/** Turns the selected lines into list items, or inserts an empty list. */
export function insertList(view: EditorView, kind: 'itemize' | 'enumerate'): void {
  const { state } = view
  const sel = state.selection.main
  const first = state.doc.lineAt(sel.from)
  const last = state.doc.lineAt(sel.to)
  const indent = /^\s*/.exec(first.text)![0]
  const lines: string[] = []
  for (let l = first.number; l <= last.number; l++) lines.push(state.doc.line(l).text.trim())
  const items = lines.filter((l) => l !== '')
  const body = (items.length ? items : ['']).map((t) => `${indent}  \\item ${t.replace(/^\\item\s*/, '')}`).join('\n')
  const insert = `${indent}\\begin{${kind}}\n${body}\n${indent}\\end{${kind}}`
  const cursor = first.from + `${indent}\\begin{${kind}}\n`.length + body.split('\n')[0].length
  view.dispatch({ changes: { from: first.from, to: last.to, insert }, selection: { anchor: cursor } })
  view.focus()
}

export function insertMath(view: EditorView, display: boolean): void {
  const { state } = view
  view.dispatch(
    state.changeByRange((r) => {
      const text = state.sliceDoc(r.from, r.to)
      if (!display) {
        return { changes: { from: r.from, to: r.to, insert: `$${text}$` }, range: EditorSelection.cursor(r.from + 1 + text.length) }
      }
      const line = state.doc.lineAt(r.from)
      const atStart = r.from === line.from
      const prefix = atStart ? '' : '\n'
      const insert = `${prefix}\\[\n  ${text}\n\\]\n`
      return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + prefix.length + 5 + text.length) }
    })
  )
  view.focus()
}

export function insertLink(view: EditorView): void {
  const { state } = view
  const r = state.selection.main
  const text = state.sliceDoc(r.from, r.to) || 'link text'
  const insert = `\\href{https://}{${text}}`
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(r.from + '\\href{https://'.length) })
  view.focus()
}

/** Inserts \ref{} or \cite{} and opens the completion list with labels or bibliography keys. */
export function insertReference(view: EditorView, cmd: 'ref' | 'cref' | 'cite'): void {
  const r = view.state.selection.main
  const insert = `\\${cmd}{}`
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(r.from + insert.length - 1) })
  view.focus()
  requestAnimationFrame(() => startCompletion(view))
}

export function insertFigure(view: EditorView, path: string): void {
  const r = view.state.selection.main
  const line = view.state.doc.lineAt(r.from)
  const base = path.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '-')
  const name = uniqueLabel(view, `fig:${base}`).slice(4)
  const prefix = r.from === line.from ? '' : '\n'
  const insert = `${prefix}\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{${path}}\n  \\caption{Caption}\n  \\label{fig:${name}}\n\\end{figure}\n`
  const captionAt = r.from + insert.indexOf('{Caption}') + 1
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.range(captionAt, captionAt + 7) })
  view.focus()
}

/** `label`, or `label-2`, `label-3`… if the document already defines it. */
function uniqueLabel(view: EditorView, label: string): string {
  const text = view.state.doc.toString()
  let candidate = label
  for (let n = 2; text.includes(`\\label{${candidate}}`); n++) candidate = `${label}-${n}`
  return candidate
}

export function insertTable(view: EditorView, rows: number, cols: number): void {
  const r = view.state.selection.main
  const line = view.state.doc.lineAt(r.from)
  const prefix = r.from === line.from ? '' : '\n'
  const header = Array.from({ length: cols }, (_, c) => `Heading ${c + 1}`).join(' & ')
  const body = Array.from({ length: Math.max(rows - 1, 1) }, () => Array.from({ length: cols }, () => '   ').join(' & ')).map((l) => `    ${l} \\\\`)
  const insert =
    `${prefix}\\begin{table}[ht]\n  \\centering\n  \\begin{tabular}{${'l'.repeat(cols)}}\n    \\hline\n    ${header} \\\\\n    \\hline\n` +
    `${body.join('\n')}\n    \\hline\n  \\end{tabular}\n  \\caption{Caption}\n  \\label{${uniqueLabel(view, 'tab:table')}}\n\\end{table}\n`
  const at = r.from + insert.indexOf('Heading 1')
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.range(at, at + 9) })
  view.focus()
}
