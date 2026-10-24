import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Compiler, LspStatus, ProjectSettings, TemplateInfo, ThemePreference, WordCount } from '@shared/types'
import { getPrefs, type Prefs } from '../prefs'

function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export interface PromptRequest {
  title: string
  label: string
  initial: string
  confirmLabel: string
  /** Selects the file name without its extension, like Finder does. */
  selectStem?: boolean
  onSubmit: (value: string) => Promise<void> | void
}

export function PromptDialog({ req, onClose }: { req: PromptRequest; onClose: () => void }) {
  const [value, setValue] = useState(req.initial)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    const dot = req.initial.lastIndexOf('.')
    const slash = req.initial.lastIndexOf('/') + 1
    if (req.selectStem && dot > slash) el.setSelectionRange(slash, dot)
    else el.select()
  }, [req])

  const submit = async () => {
    const v = value.trim()
    if (!v) return
    try {
      await req.onSubmit(v)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal title={req.title} onClose={onClose}>
      <label className="field">
        <span>{req.label}</span>
        <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} spellCheck={false} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>{req.confirmLabel}</button>
      </div>
    </Modal>
  )
}

export interface ConfirmRequest {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
}

export function ConfirmDialog({ req, onClose }: { req: ConfirmRequest; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const confirm = async () => {
    try {
      await req.onConfirm()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <Modal title={req.title} onClose={onClose}>
      <div className="modal-body">{req.message}</div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={confirm} autoFocus>{req.confirmLabel}</button>
      </div>
    </Modal>
  )
}

const COMPILERS: { value: Compiler; label: string }[] = [
  { value: 'pdflatex', label: 'pdfLaTeX' },
  { value: 'xelatex', label: 'XeLaTeX' },
  { value: 'lualatex', label: 'LuaLaTeX' }
]

export function SettingsDialog({
  settings,
  texFiles,
  lspStatus,
  onSave,
  onClose
}: {
  settings: ProjectSettings
  texFiles: string[]
  lspStatus: LspStatus
  onSave: (s: ProjectSettings, prefs: Prefs) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(settings)
  const [prefs, setPrefsDraft] = useState(getPrefs())
  const [languages, setLanguages] = useState<string[]>([])
  useEffect(() => {
    window.underleaf.spellLanguages().then((ls) => setLanguages([...ls].sort((a, b) => languageName(a).localeCompare(languageName(b)))), () => {})
  }, [])
  const files = texFiles.includes(draft.mainFile) ? texFiles : [draft.mainFile, ...texFiles]
  const check = (key: 'autoCompile' | 'spellCheck' | 'styleHints', label: string, hint: string) => (
    <label className="check-field">
      <input type="checkbox" checked={prefs[key]} onChange={(e) => setPrefsDraft({ ...prefs, [key]: e.target.checked })} />
      <span>
        {label}
        <small>{hint}</small>
      </span>
    </label>
  )
  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings-grid">
        <section>
          <h3>This project</h3>
          <label className="field">
            <span>Main document</span>
            <select value={draft.mainFile} onChange={(e) => setDraft({ ...draft, mainFile: e.target.value })}>
              {files.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Compiler</span>
            <select value={draft.compiler} onChange={(e) => setDraft({ ...draft, compiler: e.target.value as Compiler })}>
              {COMPILERS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
          <p className="hint">Use XeLaTeX or LuaLaTeX for system fonts (fontspec) and native Unicode input.</p>
        </section>
        <section>
          <h3>Editor</h3>
          <div className="field-row">
            <label className="field">
              <span>Theme</span>
              <select value={prefs.theme} onChange={(e) => setPrefsDraft({ ...prefs, theme: e.target.value as ThemePreference })}>
                <option value="system">Match macOS</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="field">
              <span>Font size</span>
              <select value={prefs.fontSize} onChange={(e) => setPrefsDraft({ ...prefs, fontSize: Number(e.target.value) })}>
                {[11, 12, 13, 13.5, 14, 15, 16, 18, 20].map((n) => (
                  <option key={n} value={n}>{n}px</option>
                ))}
              </select>
            </label>
          </div>
          {check('autoCompile', 'Compile automatically', 'Recompile a moment after you stop typing.')}
          {check('spellCheck', 'Check spelling', 'Uses macOS dictionaries, including words you taught it elsewhere.')}
          {prefs.spellCheck && (
            <label className="field">
              <span>Spelling language</span>
              <select value={prefs.spellLanguage} onChange={(e) => setPrefsDraft({ ...prefs, spellLanguage: e.target.value })}>
                <option value="auto">Detect for each document</option>
                {languages.map((l) => (
                  <option key={l} value={l}>{languageName(l)}</option>
                ))}
              </select>
            </label>
          )}
          {check('styleHints', 'Style hints (chktex)', 'Typographic suggestions, shown as dotted underlines. Needs texlab.')}
          <p className={`lsp-status ${lspStatus.available ? 'ok' : 'off'}`}>
            {lspStatus.available
              ? `texlab ${lspStatus.version ?? ''} is active: smart completion, hover info, go to definition (F12), rename (F2), format (⇧⌥F).`
              : lspStatus.error ?? 'texlab is not running.'}
          </p>
        </section>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await onSave(draft, prefs)
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  )
}

export function WordCountDialog({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState<WordCount | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.underleaf.wordCount().then(setCount, (err) => setError(errorMessage(err)))
  }, [])
  return (
    <Modal title="Word count" onClose={onClose}>
      {error && <p className="form-error">{error}</p>}
      {!count && !error && <p className="hint">Counting…</p>}
      {count && (
        <>
          <div className="wordcount-total">
            <b>{count.words.toLocaleString()}</b> words in the text
          </div>
          <table className="wordcount-table">
            <tbody>
              <tr><td>Words in headings</td><td>{count.headers.toLocaleString()}</td></tr>
              <tr><td>Words in captions and other text</td><td>{count.captions.toLocaleString()}</td></tr>
              <tr><td>Inline formulas</td><td>{count.mathInline.toLocaleString()}</td></tr>
              <tr><td>Displayed equations</td><td>{count.mathDisplay.toLocaleString()}</td></tr>
            </tbody>
          </table>
          {count.files.length > 1 && (
            <table className="wordcount-table files">
              <tbody>
                {count.files.map((f) => (
                  <tr key={f.file}><td>{f.file}</td><td>{f.words.toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">Counted with texcount, following \input and \include from the main document.</p>
        </>
      )}
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose} autoFocus>Done</button>
      </div>
    </Modal>
  )
}

export function DiffDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.underleaf.gitDiff(path).then(setDiff, (err) => setError(errorMessage(err)))
  }, [path])
  const lines = (diff ?? '').split('\n').filter((l) => !/^(diff --git|index |new file mode|--- |\+\+\+ )/.test(l))
  return (
    <Modal title={`Changes in ${path}`} onClose={onClose} wide>
      {error && <p className="form-error">{error}</p>}
      {diff !== null && lines.join('').trim() === '' && <p className="hint">No text changes (the file may be binary or only renamed).</p>}
      {diff !== null && (
        <pre className="diff-view">
          {lines.map((l, i) => (
            <div key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>
              {l || ' '}
            </div>
          ))}
        </pre>
      )}
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose} autoFocus>Close</button>
      </div>
    </Modal>
  )
}

export function TemplateDialog({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [selected, setSelected] = useState('article')
  useEffect(() => {
    window.underleaf.listTemplates().then(setTemplates)
  }, [])
  return (
    <Modal title="New project" onClose={onClose} wide>
      <div className="template-grid">
        {templates.map((t) => (
          <button
            key={t.id}
            className={`template-card${selected === t.id ? ' selected' : ''}`}
            onClick={() => setSelected(t.id)}
            onDoubleClick={() => onPick(t.id)}
          >
            <b>{t.name}</b>
            <span>{t.description}</span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onPick(selected)}>Choose location…</button>
      </div>
    </Modal>
  )
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })

function languageName(code: string): string {
  try {
    return displayNames.of(code.replace('_', '-')) ?? code
  } catch {
    return code
  }
}

export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
