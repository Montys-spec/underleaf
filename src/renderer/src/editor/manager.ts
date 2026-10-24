import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { LogEntry } from '@shared/types'
import { latexExtensions, plainExtensions } from './latex'

interface Doc {
  state: EditorState
  saved: string
  scrollTop: number
}

const flashEffect = StateEffect.define<number | null>()
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        deco = e.value === null ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-flash-line' }).range(e.value)])
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})

const LATEX_EXT = /\.(tex|sty|cls|ltx|dtx|bbx|cbx|tikz)$/i

/**
 * Owns the single CodeMirror view and one EditorState per open file, so that
 * switching tabs keeps undo history, selection and scroll position.
 */
export class EditorManager {
  readonly view: EditorView
  private docs = new Map<string, Doc>()
  private active: string | null = null
  private latexExt: Extension[]
  private plainExt: Extension[]

  constructor(
    private callbacks: {
      onChange: (path: string, dirty: boolean) => void
      onSave: () => void
      onCompile: () => void
    }
  ) {
    const update = EditorView.updateListener.of((u) => {
      if (u.docChanged && this.active) {
        const doc = this.docs.get(this.active)!
        this.callbacks.onChange(this.active, u.state.doc.toString() !== doc.saved)
      }
    })
    const save = () => this.callbacks.onSave()
    const compile = () => this.callbacks.onCompile()
    this.latexExt = [...latexExtensions(save, compile), flashField, update]
    this.plainExt = [...plainExtensions(save, compile), flashField, update]
    this.view = new EditorView({ state: EditorState.create({ doc: '', extensions: this.latexExt }) })
  }

  get activePath(): string | null {
    return this.active
  }

  has(path: string): boolean {
    return this.docs.has(path)
  }

  open(path: string, content: string): void {
    if (!this.docs.has(path)) {
      const extensions = LATEX_EXT.test(path) ? this.latexExt : this.plainExt
      this.docs.set(path, { state: EditorState.create({ doc: content, extensions }), saved: content, scrollTop: 0 })
    }
    this.activate(path)
  }

  activate(path: string): void {
    if (this.active === path) return
    this.stash()
    const doc = this.docs.get(path)
    if (!doc) return
    this.active = path
    this.view.setState(doc.state)
    requestAnimationFrame(() => {
      this.view.scrollDOM.scrollTop = doc.scrollTop
      this.view.focus()
    })
  }

  /** Detaches the view from any document (e.g. when an image is shown instead). */
  deactivate(): void {
    this.stash()
    this.active = null
  }

  close(path: string): void {
    if (this.active === path) {
      this.active = null
    }
    this.docs.delete(path)
  }

  rename(from: string, to: string): void {
    const doc = this.docs.get(from)
    if (!doc) return
    this.stash()
    this.docs.delete(from)
    this.docs.set(to, doc)
    if (this.active === from) this.active = to
  }

  content(path: string): string | undefined {
    if (path === this.active) return this.view.state.doc.toString()
    return this.docs.get(path)?.state.doc.toString()
  }

  isDirty(path: string): boolean {
    const doc = this.docs.get(path)
    return !!doc && this.content(path) !== doc.saved
  }

  dirtyPaths(): string[] {
    return [...this.docs.keys()].filter((p) => this.isDirty(p))
  }

  markSaved(path: string, content: string): void {
    const doc = this.docs.get(path)
    if (doc) doc.saved = content
  }

  /** Replaces a document with new content from disk, unless it has unsaved edits. */
  reloadFromDisk(path: string, content: string): boolean {
    const doc = this.docs.get(path)
    if (!doc || this.isDirty(path)) return false
    if (this.content(path) === content) return true
    doc.saved = content
    const state = path === this.active ? this.view.state : doc.state
    const head = Math.min(state.selection.main.head, content.length)
    const tr = state.update({ changes: { from: 0, to: state.doc.length, insert: content }, selection: { anchor: head } })
    if (path === this.active) this.view.dispatch(tr)
    else doc.state = tr.state
    return true
  }

  /** Shows compile errors and warnings as underlines and gutter markers in every open file. */
  applyDiagnostics(entries: LogEntry[]): void {
    for (const [path, doc] of this.docs) {
      const state = path === this.active ? this.view.state : doc.state
      const diagnostics = toDiagnostics(state, entries.filter((e) => e.file === path))
      const spec = setDiagnostics(state, diagnostics)
      if (path === this.active) this.view.dispatch(spec)
      else doc.state = state.update(spec).state
    }
  }

  diagnosticsFor(path: string, entries: LogEntry[]): void {
    if (path !== this.active) return
    this.view.dispatch(setDiagnostics(this.view.state, toDiagnostics(this.view.state, entries.filter((e) => e.file === path))))
  }

  goToLine(line: number): void {
    // Runs after activate() has restored the tab's scroll position in its own frame.
    requestAnimationFrame(() => {
      const doc = this.view.state.doc
      const l = doc.line(Math.max(1, Math.min(line, doc.lines)))
      this.view.dispatch({
        selection: { anchor: l.from },
        effects: [EditorView.scrollIntoView(l.from, { y: 'center' }), flashEffect.of(l.from)]
      })
      this.view.focus()
      setTimeout(() => this.view.dispatch({ effects: flashEffect.of(null) }), 1200)
    })
  }

  private stash(): void {
    if (!this.active) return
    const doc = this.docs.get(this.active)
    if (doc) {
      doc.state = this.view.state
      doc.scrollTop = this.view.scrollDOM.scrollTop
    }
  }
}

function toDiagnostics(state: EditorState, entries: LogEntry[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const e of entries) {
    if (!e.line || e.line > state.doc.lines) continue
    const line = state.doc.line(e.line)
    // Underline the first non-blank stretch of the line instead of the leading indentation.
    const offset = line.text.length - line.text.trimStart().length
    out.push({
      from: line.from + offset,
      to: Math.max(line.to, line.from + offset),
      severity: e.level === 'error' ? 'error' : e.level === 'warning' ? 'warning' : 'info',
      message: e.message,
      source: e.level === 'typesetting' ? 'Typesetting' : 'LaTeX'
    })
  }
  return out
}
