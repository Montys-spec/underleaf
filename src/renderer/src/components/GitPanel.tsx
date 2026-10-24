import { useCallback, useEffect, useState } from 'react'
import type { GitStatus } from '@shared/types'
import { errorMessage } from './Dialogs'
import { DownIcon, RefreshIcon, UpIcon } from './icons'

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  M: { label: 'M', cls: 'modified' },
  A: { label: 'A', cls: 'added' },
  D: { label: 'D', cls: 'deleted' },
  R: { label: 'R', cls: 'renamed' },
  '?': { label: 'U', cls: 'added' }
}

function describe(status: string) {
  const code = status.trim()[0] ?? 'M'
  return STATUS_LABEL[code] ?? { label: code, cls: 'modified' }
}

function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 60) return `${Math.max(mins, 1)} min`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} h`
  return new Date(ts).toLocaleDateString()
}

interface Props {
  refreshSeq: number
  beforeCommit: () => Promise<void>
  onShowDiff: (path: string) => void
  onNotify: (message: string) => void
}

/** A small source-control view: changed files, commit everything, push/pull, history. */
export function GitPanel({ refreshSeq, beforeCommit, onShowDiff, onNotify }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.underleaf.gitStatus())
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshSeq])

  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      if (done) onNotify(done)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  if (!status) return <div className="git-panel"><div className="pane-header"><span className="pane-title">Source control</span></div></div>

  return (
    <div className="git-panel">
      <div className="pane-header">
        <span className="pane-title">Source control</span>
        <div className="pane-actions">
          {status.isRepo && status.hasRemote && (
            <>
              <button className="icon-btn" title="Pull" disabled={!!busy} onClick={() => act('pull', () => window.underleaf.gitPull(), 'Pulled latest changes.')}>
                <DownIcon />
              </button>
              <button className="icon-btn" title="Push" disabled={!!busy} onClick={() => act('push', () => window.underleaf.gitPush(), 'Pushed to remote.')}>
                <UpIcon />
              </button>
            </>
          )}
          <button className="icon-btn" title="Refresh" onClick={() => void refresh()}>
            <RefreshIcon />
          </button>
        </div>
      </div>

      {!status.available && <p className="panel-note">Git is not installed. Run <code>xcode-select --install</code> in Terminal to get it.</p>}

      {status.available && !status.isRepo && (
        <div className="panel-note">
          <p>This project is not under version control yet. Git keeps a history of your changes and lets you sync with GitHub.</p>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => act('init', () => window.underleaf.gitInit(), 'Repository created.')}>
            Initialize repository
          </button>
        </div>
      )}

      {status.isRepo && (
        <div className="git-body">
          <div className="git-branch">
            On <b>{status.branch || 'main'}</b>
            {status.ahead > 0 && <span className="git-sync"> · {status.ahead} to push</span>}
            {status.behind > 0 && <span className="git-sync"> · {status.behind} to pull</span>}
          </div>
          <textarea
            className="git-message"
            placeholder="Describe your changes"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.metaKey) (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click()
            }}
            rows={3}
          />
          <button
            className="btn btn-primary git-commit"
            disabled={!!busy || status.changes.length === 0 || !message.trim()}
            onClick={() =>
              act(
                'commit',
                async () => {
                  await beforeCommit()
                  await window.underleaf.gitCommit(message)
                  setMessage('')
                },
                'Changes committed.'
              )
            }
            title="Commit all changes (⌘↵)"
          >
            {busy === 'commit' ? 'Committing…' : `Commit ${status.changes.length} change${status.changes.length === 1 ? '' : 's'}`}
          </button>
          {error && <p className="form-error">{error}</p>}

          <h4 className="git-heading">Changes</h4>
          {status.changes.length === 0 && <p className="panel-muted">No uncommitted changes.</p>}
          <ul className="git-changes">
            {status.changes.map((c) => {
              const d = describe(c.status)
              return (
                <li key={c.path}>
                  <button onClick={() => onShowDiff(c.path)} title="Show changes">
                    <span className="git-path">{c.path}</span>
                    <span className={`git-status ${d.cls}`}>{d.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          <h4 className="git-heading">History</h4>
          {status.commits.length === 0 && <p className="panel-muted">No commits yet.</p>}
          <ul className="git-log">
            {status.commits.map((c) => (
              <li key={c.hash} title={`${c.hash}\n${c.author}`}>
                <span className="git-subject">{c.subject}</span>
                <span className="git-meta">
                  {c.author} · {ago(c.date)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!status.isRepo && error && <p className="form-error panel-note">{error}</p>}
    </div>
  )
}
