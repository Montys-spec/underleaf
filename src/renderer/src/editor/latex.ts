import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionSource } from '@codemirror/autocomplete'
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
import { spellChecker, type LanguageGetter } from './spell'

export const latexLanguage = StreamLanguage.define(stex)

// Colours come from CSS variables so light and dark themes share one definition.
const latexHighlight = HighlightStyle.define([
  { tag: t.tagName, color: 'var(--hl-command)' },
  { tag: t.keyword, color: 'var(--hl-keyword)' },
  { tag: t.atom, color: 'var(--hl-argument)' },
  { tag: t.special(t.variableName), color: 'var(--hl-math)' },
  { tag: t.number, color: 'var(--hl-math)' },
  { tag: t.bracket, color: 'var(--hl-bracket)' },
  { tag: t.comment, color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--error)' }
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

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size, 13.5px)', backgroundColor: 'var(--bg)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: "'SF Mono', Menlo, Monaco, monospace", lineHeight: '1.6' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': { background: 'var(--bg-subtle)', borderRight: '1px solid var(--border)', color: 'var(--text-faint)' },
  '.cm-activeLineGutter': { background: 'var(--bg-sunken)' },
  '.cm-activeLine': { background: 'var(--active-line)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'var(--select-strong) !important' },
  '.cm-selectionMatch': { background: 'var(--selection-match)' },
  '.cm-matchingBracket': { background: 'var(--selection-match)', outline: '1px solid var(--border-strong)' },
  '.cm-searchMatch': { background: 'var(--search-match)', outline: '1px solid var(--warning)' },
  '.cm-searchMatch.cm-searchMatch-selected': { background: 'var(--search-match-strong)' },
  '.cm-panels': { background: 'var(--bg-subtle)', color: 'var(--text)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-tooltip': { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--select-strong)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', marginLeft: '1em' },
  '.cm-foldPlaceholder': { background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-muted)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--error)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warning)', textUnderlineOffset: '3px' },
  '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted var(--info)', textUnderlineOffset: '3px' },
  '.cm-misspelled': { textDecoration: 'underline wavy var(--spelling)', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
  '.cm-flash-line': { background: 'var(--flash) !important', transition: 'background 1s' }
})

export interface EditorHooks {
  onSave: () => void
  onCompile: () => void
  onSyncToPdf: () => void
  /** Completion sources, read on every request so they can change at runtime (texlab on/off). */
  completionSources: () => CompletionSource[]
  spellEnabled: () => boolean
  spellLanguage: LanguageGetter
}

export function baseExtensions(hooks: EditorHooks, latex: boolean): Extension[] {
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
    autocompletion({
      override: [(ctx) => {
        // Ask every source and merge, so texlab results and snippets appear together.
        const results = hooks.completionSources().map((s) => s(ctx))
        return Promise.all(results).then((rs) => {
          const valid = rs.filter((r): r is NonNullable<typeof r> => !!r)
          if (!valid.length) return null
          const from = Math.min(...valid.map((r) => r.from))
          return { from, options: valid.flatMap((r) => (r.from === from ? r.options : [])) }
        })
      }],
      icons: false,
      activateOnTypingDelay: 50
    }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    ...(latex ? [latexLanguage, spellChecker(hooks.spellEnabled, hooks.spellLanguage)] : []),
    syntaxHighlighting(latexHighlight),
    editorTheme,
    keymap.of([
      { key: 'Mod-s', run: () => (hooks.onSave(), true) },
      { key: 'Mod-Enter', run: () => (hooks.onCompile(), true) },
      { key: 'Mod-j', run: () => (hooks.onSyncToPdf(), true) },
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
