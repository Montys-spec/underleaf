import { useState } from 'react'
import type { CompileResult, LogEntry, LogLevel } from '@shared/types'
import { ErrorIcon, InfoIcon, WarningIcon } from './icons'

const LABEL: Record<LogLevel, string> = { error: 'Error', warning: 'Warning', typesetting: 'Typesetting' }
const ICON = { error: ErrorIcon, warning: WarningIcon, typesetting: InfoIcon }
const ORDER: LogLevel[] = ['error', 'warning', 'typesetting']

export function LogPanel({ result, onJump }: { result: CompileResult | null; onJump: (entry: LogEntry) => void }) {
  const [filter, setFilter] = useState<LogLevel | 'all'>('all')
  const [showRaw, setShowRaw] = useState(false)

  if (!result) {
    return <div className="log-panel empty">Compile the project to see logs.</div>
  }

  const counts = Object.fromEntries(ORDER.map((l) => [l, result.entries.filter((e) => e.level === l).length])) as Record<LogLevel, number>
  const entries = [...result.entries]
    .filter((e) => filter === 'all' || e.level === filter)
    .sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level))

  return (
    <div className="log-panel">
      <div className="log-filters">
        <button className={`chip${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          All <b>{result.entries.length}</b>
        </button>
        {ORDER.map((l) => (
          <button key={l} className={`chip chip-${l}${filter === l ? ' active' : ''}`} onClick={() => setFilter(l)}>
            {l === 'typesetting' ? LABEL[l] : LABEL[l] + 's'} <b>{counts[l]}</b>
          </button>
        ))}
        <span className="log-meta">
          {result.status === 'cancelled' ? 'Stopped' : `${(result.durationMs / 1000).toFixed(1)}s`}
        </span>
      </div>

      {entries.length === 0 && (
        <div className="log-clean">{result.entries.length === 0 ? 'No errors or warnings. Nice work.' : 'Nothing in this category.'}</div>
      )}

      <ul className="log-list">
        {entries.map((e, i) => {
          const Icon = ICON[e.level]
          const clickable = !!e.file
          return (
            <li key={i} className={`log-entry log-${e.level}${clickable ? ' clickable' : ''}`} onClick={() => clickable && onJump(e)}>
              <div className="log-head">
                <Icon size={14} />
                <span className="log-message">{e.message}</span>
                {e.file && (
                  <span className="log-location">
                    {e.file}
                    {e.line ? `, line ${e.line}` : ''}
                  </span>
                )}
              </div>
              {e.context && <pre className="log-context">{e.context}</pre>}
            </li>
          )
        })}
      </ul>

      {result.savedPdf && <div className="log-saved">PDF saved to {result.savedPdf}</div>}

      <button className="raw-toggle" onClick={() => setShowRaw((v) => !v)}>
        {showRaw ? 'Hide raw logs' : 'Show raw logs'}
      </button>
      {showRaw && (
        <pre className="raw-log">
          {result.rawLog || '(no TeX log was written)'}
          {'\n\n──── latexmk output ────\n\n'}
          {result.output}
        </pre>
      )}
    </div>
  )
}
