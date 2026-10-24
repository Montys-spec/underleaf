import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { Compartment, EditorState, StateEffect, StateField, type Extension, type TransactionSpec } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { LogEntry } from '@shared/types'
import type { LspDiagnostic } from '../lsp/texlab'
import { baseExtensions, type EditorHooks } from './latex'
import { refreshSpelling } from './spell'

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
/** Each document holds its language-server connection in this compartment, so it can be attached later. */
const lspCompartment = new Compartment()

export interface ManagerCallbacks extends EditorHooks {
  onChange: (path: string, dirty: boolean) => void
  onCursor: (path: string, line: number) => void
  onContextMenu: (pos: number, x: number, y: number) => void
}

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
  private compileEntries: LogEntry[] = []
  private lspDiagnostics = new Map<string, LspDiagnostic[]>()
  private lspFor: (path: string) => Extension = () => []

  constructor(private callbacks: ManagerCallbacks) {
    const listener = EditorView.updateListener.of((u) => {
      if (!this.active) return
      if (u.docChanged) {
        const doc = this.docs.get(this.active)!
        this.callbacks.onChange(this.active, u.state.doc.toString() !== doc.saved)
      }
      if (u.docChanged || u.selectionSet) {
        this.callbacks.onCursor(this.active, u.state.doc.lineAt(u.state.selection.main.head).number)
      }
    })
    const contextMenu = EditorView.domEventHandlers({
      contextmenu: (e, view) => {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos === null) return false
        e.preventDefault()
        // Right-clicking outside the selection moves the cursor there, as in other editors.
        const sel = view.state.selection.main
        if (pos < sel.from || pos > sel.to) view.dispatch({ selection: { anchor: pos } })
        this.callbacks.onContextMenu(pos, e.clientX, e.clientY)
        return true
      }
    })
    const common = [flashField, listener, contextMenu, lspCompartment.of([])]
    this.latexExt = [...baseExtensions(callbacks, true), ...common]
    this.plainExt = [...baseExtensions(callbacks, false), ...common]
    this.view = new EditorView({ state: EditorState.create({ doc: '', extensions: this.latexExt }) })
  }

  get activePath(): string | null {
    return this.active
  }

  has(path: string): boolean {
    return this.docs.has(path)
  }

  paths(): string[] {
    return [...this.docs.keys()]
  }

  open(path: string, content: string): void {
    if (!this.docs.has(path)) {
      const extensions = LATEX_EXT.test(path) ? this.latexExt : this.plainExt
      let state = EditorState.create({ doc: content, extensions })
      state = state.update({ effects: lspCompartment.reconfigure(this.lspFor(path)) }).state
      this.docs.set(path, { state, saved: content, scrollTop: 0 })
      this.refreshDiagnostics(path)
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
    this.callbacks.onCursor(path, doc.state.doc.lineAt(doc.state.selection.main.head).number)
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
      // Swap in an empty state so the closed file's language-server plugin shuts down.
      this.view.setState(EditorState.create({ doc: '' }))
      this.active = null
    }
    this.docs.delete(path)
  }

  rename(from: string, to: string): void {
    const doc = this.docs.get(from)
    if (!doc) return
    this.stash()
    this.docs.delete(from)
    // The language server knows files by path, so reconnect under the new name.
    doc.state = doc.state.update({ effects: lspCompartment.reconfigure(this.lspFor(to)) }).state
    this.docs.set(to, doc)
    if (this.active === from) {
      this.active = to
      this.view.setState(doc.state)
    }
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
    this.update(path, (state) => {
      const head = Math.min(state.selection.main.head, content.length)
      return { changes: { from: 0, to: state.doc.length, insert: content }, selection: { anchor: head } }
    })
    return true
  }

  /** Connects documents to the language server (or disconnects them when given null). */
  setLanguageServer(extensionFor: ((path: string) => Extension) | null): void {
    this.lspFor = extensionFor ?? (() => [])
    for (const path of this.docs.keys()) {
      this.update(path, () => ({ effects: lspCompartment.reconfigure(this.lspFor(path)) }))
    }
  }

  /** Shows compile errors and warnings as underlines and gutter markers in every open file. */
  applyCompileDiagnostics(entries: LogEntry[]): void {
    this.compileEntries = entries
    for (const path of this.docs.keys()) this.refreshDiagnostics(path)
  }

  applyLspDiagnostics(path: string, diagnostics: LspDiagnostic[]): void {
    this.lspDiagnostics.set(path, diagnostics)
    if (this.docs.has(path)) this.refreshDiagnostics(path)
  }

  refreshSpelling(): void {
    this.view.dispatch({ effects: refreshSpelling.of(null) })
  }

  /** Current cursor position as 1-based line and column, for SyncTeX. */
  cursor(): { line: number; column: number } | null {
    if (!this.active) return null
    const head = this.view.state.selection.main.head
    const line = this.view.state.doc.lineAt(head)
    return { line: line.number, column: head - line.from + 1 }
  }

  goToLine(line: number, column?: number, length = 0): void {
    // Runs after activate() has restored the tab's scroll position in its own frame.
    requestAnimationFrame(() => {
      const doc = this.view.state.doc
      const l = doc.line(Math.max(1, Math.min(line, doc.lines)))
      const anchor = column !== undefined ? Math.min(l.from + column, l.to) : l.from
      this.view.dispatch({
        selection: { anchor, head: Math.min(anchor + length, l.to) },
        effects: [EditorView.scrollIntoView(anchor, { y: 'center' }), flashEffect.of(l.from)]
      })
      this.view.focus()
      setTimeout(() => this.view.dispatch({ effects: flashEffect.of(null) }), 1200)
    })
  }

  private refreshDiagnostics(path: string): void {
    const doc = this.docs.get(path)
    if (!doc) return
    const state = path === this.active ? this.view.state : doc.state
    // Both layers are line-based, so recomputing them against the current document is cheap and stays aligned.
    const compile = compileToDiagnostics(state, this.compileEntries.filter((e) => e.file === path))
    const lsp = lspToDiagnostics(state, this.lspDiagnostics.get(path) ?? [])
    const all = [...compile, ...lsp]
    this.update(path, (s) => setDiagnostics(s, all))
  }

  private update(path: string, spec: (state: EditorState) => TransactionSpec): void {
    if (path === this.active) {
      this.view.dispatch(spec(this.view.state))
    } else {
      const doc = this.docs.get(path)
      if (doc) doc.state = doc.state.update(spec(doc.state)).state
    }
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

function compileToDiagnostics(state: EditorState, entries: LogEntry[]): Diagnostic[] {
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

function lspToDiagnostics(state: EditorState, diagnostics: LspDiagnostic[]): Diagnostic[] {
  const doc = state.doc
  const pos = (p: { line: number; character: number }) => {
    if (p.line + 1 > doc.lines) return doc.length
    const line = doc.line(p.line + 1)
    return Math.min(line.from + p.character, line.to)
  }
  return diagnostics.map((d) => {
    const from = pos(d.range.start)
    const to = Math.max(from, pos(d.range.end))
    // chktex hints are stylistic, so keep them low-key.
    const severity: Diagnostic['severity'] = d.source === 'ChkTeX' || d.source === 'chktex' ? 'info' : d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info'
    return { from, to, severity, message: d.message, source: d.source ?? 'texlab' }
  })
}
