import { useCallback, useEffect, useState } from 'react'
import type { ProjectInfo, RecentProject } from '@shared/types'
import { errorMessage } from './components/Dialogs'
import { FolderIcon, LeafIcon, NewFolderIcon } from './components/icons'
import { Workspace } from './components/Workspace'

const api = window.underleaf

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (fn: () => Promise<ProjectInfo | null>) => {
    try {
      setError(null)
      const p = await fn()
      if (p) setProject(p)
      return p
    } catch (err) {
      setError(errorMessage(err))
      return null
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      await run(() => api.getInitialProject())
      setRecent(await api.getRecentProjects())
      setReady(true)
    })()
  }, [run])

  useEffect(
    () =>
      api.onMenu((cmd) => {
        if (cmd === 'reload-project') void run(() => api.refreshProject())
        // While a project is open the workspace handles these, after saving its edits.
        if (project) return
        if (cmd === 'open-project') void run(() => api.openProjectDialog())
        if (cmd === 'new-project') void run(() => api.newProjectDialog())
      }),
    [project, run]
  )

  const leave = useCallback(
    async (next: 'home' | 'open' | 'new') => {
      if (next === 'open' && !(await run(() => api.openProjectDialog()))) return
      if (next === 'new' && !(await run(() => api.newProjectDialog()))) return
      if (next === 'home') {
        await api.closeProject()
        setProject(null)
        document.title = 'Underleaf'
      }
      setRecent(await api.getRecentProjects())
    },
    [run]
  )

  if (project) return <Workspace key={project.root} initial={project} onLeave={leave} />
  if (!ready) return <div className="welcome" />

  return (
    <div className="welcome">
      <div className="welcome-drag" />
      <div className="welcome-card">
        <div className="welcome-brand">
          <LeafIcon size={34} />
          <div>
            <h1>Underleaf</h1>
            <p>Your LaTeX projects, compiled locally.</p>
          </div>
        </div>
        <div className="welcome-actions">
          <button className="btn btn-primary btn-lg" onClick={() => void run(() => api.newProjectDialog())}>
            <NewFolderIcon size={17} /> New project
          </button>
          <button className="btn btn-lg" onClick={() => void run(() => api.openProjectDialog())}>
            <FolderIcon size={17} /> Open folder…
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <h3>Recent projects</h3>
        {recent.length === 0 ? (
          <p className="welcome-empty">Projects you open will appear here. Any folder with .tex files works.</p>
        ) : (
          <ul className="recent-list">
            {recent.map((r) => (
              <li key={r.root}>
                <button onClick={() => void run(() => api.openProject(r.root))}>
                  <FolderIcon size={16} />
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-path">{r.root.replace(/^\/Users\/[^/]+/, '~')}</span>
                  <span className="recent-date">{relativeTime(r.openedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function relativeTime(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(ts).toLocaleDateString()
}
