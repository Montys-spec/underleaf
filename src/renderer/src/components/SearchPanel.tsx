import { useEffect, useRef, useState } from 'react'
import type { SearchFileResult, SearchOptions } from '@shared/types'
import { errorMessage } from './Dialogs'
import { ChevronIcon, fileIconFor } from './icons'

interface Props {
  focusSeq: number
  /** Saves open editors first, so the search sees what is on screen. */
  beforeSearch: () => Promise<void>
  onOpenMatch: (file: string, line: number, column: number, length: number) => void
  onReplaced: (files: string[]) => Promise<void>
  confirmReplace: (count: number, files: number, run: () => Promise<void>) => void
}

export function SearchPanel({ focusSeq, beforeSearch, onOpenMatch, onReplaced, confirmReplace }: Props) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [opts, setOpts] = useState({ regex: false, caseSensitive: false, wholeWord: false })
  const [results, setResults] = useState<SearchFileResult[] | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusSeq])

  const options = (): SearchOptions => ({ query, ...opts })

  const run = async () => {
    const mine = ++seq.current
    if (!query) {
      setResults(null)
      setError(null)
      return
    }
    try {
      if (opts.regex) new RegExp(query, 'u')
    } catch (err) {
      setError(errorMessage(err))
      setResults(null)
      return
    }
    setBusy(true)
    try {
      await beforeSearch()
      const res = await window.underleaf.search(options())
      if (mine === seq.current) {
        setResults(res)
        setError(null)
      }
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err))
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    const t = window.setTimeout(run, 250)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, opts])

  const total = results?.reduce((n, r) => n + r.matches.length, 0) ?? 0

  const replaceAll = () => {
    if (!results || total === 0) return
    confirmReplace(total, results.length, async () => {
      await beforeSearch()
      const res = await window.underleaf.replaceAll(options(), replacement)
      await onReplaced(res.files)
      await run()
    })
  }

  const toggle = (key: keyof typeof opts, label: string, title: string) => (
    <button className={`search-toggle${opts[key] ? ' active' : ''}`} title={title} aria-pressed={opts[key]} onClick={() => setOpts((o) => ({ ...o, [key]: !o[key] }))}>
      {label}
    </button>
  )

  return (
    <div className="search-panel">
      <div className="pane-header">
        <span className="pane-title">Search project</span>
      </div>
      <div className="search-form">
        <div className="search-input-row">
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" spellCheck={false} onKeyDown={(e) => e.key === 'Enter' && run()} />
          {toggle('caseSensitive', 'Aa', 'Match case')}
          {toggle('wholeWord', 'ab', 'Whole word')}
          {toggle('regex', '.*', 'Regular expression')}
        </div>
        <div className="search-input-row">
          <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replace" spellCheck={false} />
          <button className="btn btn-small" disabled={!total} onClick={replaceAll} title="Replace all matches in the project">
            Replace all
          </button>
        </div>
        <div className="search-summary">
          {error ? <span className="form-error">{error}</span> : busy ? 'Searching…' : results ? `${total} result${total === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}` : ''}
        </div>
      </div>
      <div className="search-results">
        {results?.map((r) => {
          const Icon = fileIconFor(r.file)
          const isCollapsed = collapsed.has(r.file)
          return (
            <div key={r.file} className="search-file">
              <button
                className="search-file-header"
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev)
                    if (next.has(r.file)) next.delete(r.file)
                    else next.add(r.file)
                    return next
                  })
                }
              >
                <span className={`tree-chevron${isCollapsed ? '' : ' open'}`}>
                  <ChevronIcon size={12} />
                </span>
                <Icon size={14} />
                <span className="search-file-name">{r.file}</span>
                <span className="search-count">{r.matches.length}</span>
              </button>
              {!isCollapsed &&
                r.matches.map((m, i) => {
                  const start = m.column - m.previewOffset
                  return (
                    <button key={i} className="search-match" onClick={() => onOpenMatch(r.file, m.line, m.column, m.length)} title={`Line ${m.line}`}>
                      <span className="search-line">{m.line}</span>
                      <span className="search-preview">
                        {m.preview.slice(0, start).trimStart()}
                        <mark>{m.preview.slice(start, start + m.length)}</mark>
                        {m.preview.slice(start + m.length)}
                      </span>
                    </button>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
