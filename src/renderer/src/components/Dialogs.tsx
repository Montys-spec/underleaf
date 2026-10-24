import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Compiler, ProjectSettings } from '@shared/types'

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
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
  onSave,
  onClose
}: {
  settings: ProjectSettings
  texFiles: string[]
  onSave: (s: ProjectSettings) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(settings)
  const files = texFiles.includes(draft.mainFile) ? texFiles : [draft.mainFile, ...texFiles]
  return (
    <Modal title="Project settings" onClose={onClose}>
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
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await onSave(draft)
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  )
}

export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
