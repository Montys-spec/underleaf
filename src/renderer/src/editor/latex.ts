import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { lintGutter } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorSelection, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type Command
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const latexLanguage = StreamLanguage.define(stex)

const latexHighlight = HighlightStyle.define([
  { tag: t.tagName, color: '#1b5fb4' },
  { tag: t.keyword, color: '#8a2b9a' },
  { tag: t.atom, color: '#0f7a52' },
  { tag: t.special(t.variableName), color: '#b8560b' },
  { tag: t.number, color: '#b8560b' },
  { tag: t.bracket, color: '#5f6b7a' },
  { tag: t.comment, color: '#7c8a7f', fontStyle: 'italic' },
  { tag: t.invalid, color: '#c62828' }
])

/** Wraps the selection in `\cmd{...}`, or inserts an empty one at the cursor. */
function wrapWith(cmd: string): Command {
  return (view) => {
    view.dispatch(
      view.state.changeByRange((range) => {
        const text = view.state.sliceDoc(range.from, range.to)
        const insert = `\\${cmd}{${text}}`
        const start = range.from + cmd.length + 2
        return {
          changes: { from: range.from, to: range.to, insert },
          range: range.empty ? EditorSelection.cursor(start) : EditorSelection.range(start, start + text.length)
        }
      })
    )
    return true
  }
}

const COMMANDS = [
  'section{}', 'subsection{}', 'subsubsection{}', 'paragraph{}', 'chapter{}', 'part{}',
  'textbf{}', 'textit{}', 'emph{}', 'underline{}', 'texttt{}', 'textsc{}', 'footnote{}',
  'label{}', 'ref{}', 'eqref{}', 'pageref{}', 'cite{}', 'citep{}', 'citet{}', 'url{}', 'href{}{}',
  'includegraphics[width=\\linewidth]{}', 'input{}', 'include{}', 'usepackage{}', 'documentclass{}',
  'title{}', 'author{}', 'date{}', 'maketitle', 'tableofcontents', 'newpage', 'clearpage', 'centering',
  'caption{}', 'item', 'frac{}{}', 'sqrt{}', 'sum', 'int', 'infty', 'alpha', 'beta', 'gamma', 'delta',
  'epsilon', 'lambda', 'mu', 'pi', 'sigma', 'theta', 'omega', 'mathbb{}', 'mathcal{}', 'mathrm{}',
  'left(', 'right)', 'cdot', 'times', 'leq', 'geq', 'neq', 'approx', 'quad', 'qquad', 'hline',
  'bibliography{}', 'bibliographystyle{}', 'printbibliography', 'addbibresource{}', 'newcommand{}{}',
  'vspace{}', 'hspace{}', 'noindent', 'today', 'LaTeX', 'TeX'
]
const ENVIRONMENTS = [
  'itemize', 'enumerate', 'description', 'figure', 'table', 'tabular', 'equation', 'equation*',
  'align', 'align*', 'gather', 'multline', 'center', 'abstract', 'quote', 'verbatim', 'minipage',
  'theorem', 'lemma', 'proof', 'document', 'frame', 'thebibliography'
]

function latexCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\\[A-Za-z]*/)
  if (!word || (word.from === word.to && !ctx.explicit)) return null
  const commands = COMMANDS.map((c) => {
    const name = c.replace(/[[{(].*$/, '')
    return {
      label: '\\' + name,
      detail: c.slice(name.length) || undefined,
      type: 'keyword',
      apply: (view: EditorView, _c: unknown, from: number, to: number) => {
        const insert = '\\' + c
        const brace = insert.search(/\{\}|\(\)/)
        const cursor = from + (brace >= 0 ? brace + 1 : insert.length)
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor } })
      }
    }
  })
  const envs = ENVIRONMENTS.map((env) => ({
    label: '\\begin{' + env + '}',
    type: 'class',
    apply: (view: EditorView, _c: unknown, from: number, to: number) => {
      const line = view.state.doc.lineAt(from)
      const indent = /^\s*/.exec(line.text)![0]
      const body = env === 'itemize' || env === 'enumerate' ? '\\item ' : ''
      const insert = `\\begin{${env}}\n${indent}  ${body}\n${indent}\\end{${env}}`
      const cursor = from + `\\begin{${env}}\n${indent}  ${body}`.length
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor } })
    }
  }))
  return { from: word.from, options: [...envs, ...commands], validFor: /^\\[A-Za-z]*$/ }
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px' },
  '.cm-scroller': { fontFamily: "'SF Mono', Menlo, Monaco, monospace", lineHeight: '1.6' },
  '.cm-content': { padding: '8px 0' },
  '.cm-gutters': { background: '#f6f7f9', borderRight: '1px solid #e3e6ea', color: '#9aa3ad' },
  '.cm-activeLineGutter': { background: '#e8ecf1' },
  '.cm-activeLine': { background: 'rgba(30, 80, 160, 0.045)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { background: '#cfe0f7 !important' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #d93025', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #e2a400', textUnderlineOffset: '3px' },
  '.cm-flash-line': { background: 'rgba(255, 213, 79, 0.45)', transition: 'background 1s' }
})

export function latexExtensions(onSave: () => void, onCompile: () => void): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    lintGutter(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [latexCompletions], icons: false }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    latexLanguage,
    syntaxHighlighting(latexHighlight),
    editorTheme,
    keymap.of([
      { key: 'Mod-s', run: () => (onSave(), true) },
      { key: 'Mod-Enter', run: () => (onCompile(), true) },
      { key: 'Mod-b', run: wrapWith('textbf') },
      { key: 'Mod-i', run: wrapWith('textit') },
      { key: 'Mod-/', run: toggleComment },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab
    ])
  ]
}

/** Extensions for non-LaTeX text files (.bib, .cls, .txt, ...). */
export function plainExtensions(onSave: () => void, onCompile: () => void): Extension[] {
  return latexExtensions(onSave, onCompile).filter((e) => e !== latexLanguage)
}
