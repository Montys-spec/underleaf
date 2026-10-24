import { promises as fs, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { FileNode, FsChangeEvent, ProjectInfo, ProjectSettings } from '@shared/types'

export const META_DIR = '.underleaf'
const SETTINGS_FILE = 'settings.json'

/** Entries that never show up in the file tree. */
const HIDDEN = new Set([META_DIR, '.git', 'node_modules', '.DS_Store', '.Trash'])
/** LaTeX by-products that may exist from compiles outside Underleaf. */
const AUX_EXT = /\.(aux|log|fls|fdb_latexmk|synctex\.gz|synctex|out|toc|lof|lot|bbl|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi|idx|ilg|ind|glo|gls|glg)$/

const DEFAULT_SETTINGS: ProjectSettings = { mainFile: 'main.tex', compiler: 'pdflatex' }

export class Project {
  readonly root: string
  settings: ProjectSettings = { ...DEFAULT_SETTINGS }
  private watcher?: FSWatcher
  private debounce = new Map<string, NodeJS.Timeout>()
  /** Paths written by the app itself recently; their change events are not echoed back. */
  private ownWrites = new Map<string, number>()

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  get name(): string {
    return path.basename(this.root)
  }

  get metaDir(): string {
    return path.join(this.root, META_DIR)
  }

  get buildDir(): string {
    return path.join(this.metaDir, 'build')
  }

  async load(): Promise<void> {
    await fs.mkdir(this.metaDir, { recursive: true })
    // Keep build output out of git without touching the user's own .gitignore.
    await fs.writeFile(path.join(this.metaDir, '.gitignore'), '*\n')
    try {
      const raw = await fs.readFile(path.join(this.metaDir, SETTINGS_FILE), 'utf8')
      this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS, mainFile: (await this.detectMainFile()) ?? 'main.tex' }
      await this.saveSettings(this.settings)
    }
  }

  async saveSettings(settings: ProjectSettings): Promise<ProjectSettings> {
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
    await fs.writeFile(path.join(this.metaDir, SETTINGS_FILE), JSON.stringify(this.settings, null, 2) + '\n')
    return this.settings
  }

  async info(): Promise<ProjectInfo> {
    const tree = await this.readTree()
    return { root: this.root, name: this.name, settings: this.settings, tree, texFiles: collectTex(tree) }
  }

  /** Resolves a project-relative path and refuses anything that escapes the root. */
  resolve(rel: string): string {
    const full = path.resolve(this.root, rel)
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`Path is outside the project: ${rel}`)
    }
    return full
  }

  relative(full: string): string {
    return path.relative(this.root, full).split(path.sep).join('/')
  }

  async readTree(dir = this.root): Promise<FileNode[]> {
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    const nodes: FileNode[] = []
    for (const d of dirents) {
      if (HIDDEN.has(d.name) || d.name.startsWith('.')) continue
      const full = path.join(dir, d.name)
      if (d.isDirectory()) {
        nodes.push({ name: d.name, path: this.relative(full), type: 'dir', children: await this.readTree(full) })
      } else if (d.isFile() && !AUX_EXT.test(d.name)) {
        nodes.push({ name: d.name, path: this.relative(full), type: 'file' })
      }
    }
    return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1))
  }

  async detectMainFile(): Promise<string | undefined> {
    const texFiles = collectTex(await this.readTree())
    const candidates: string[] = []
    for (const f of texFiles) {
      try {
        const head = (await fs.readFile(this.resolve(f), 'utf8')).slice(0, 20000)
        if (/^[^%\n]*\\documentclass/m.test(head)) candidates.push(f)
      } catch {
        // Unreadable files are simply not candidates.
      }
    }
    const preferred = ['main.tex', 'thesis.tex', 'paper.tex', 'report.tex', 'document.tex']
    candidates.sort((a, b) => {
      const pa = preferred.indexOf(a), pb = preferred.indexOf(b)
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
      return a.split('/').length - b.split('/').length || a.localeCompare(b)
    })
    return candidates[0] ?? texFiles[0]
  }

  markOwnWrite(rel: string): void {
    this.ownWrites.set(rel, Date.now())
  }

  watch(onChange: (e: FsChangeEvent) => void): void {
    this.watcher = watch(this.root, { recursive: true }, (event, filename) => {
      if (!filename) return
      const rel = filename.split(path.sep).join('/')
      const top = rel.split('/')[0]
      if (top === META_DIR || top === '.git' || top === 'node_modules') return
      const key = event === 'rename' ? '__tree__' : rel
      clearTimeout(this.debounce.get(key))
      this.debounce.set(
        key,
        setTimeout(() => {
          this.debounce.delete(key)
          if (event === 'rename') {
            onChange({ kind: 'tree' })
            return
          }
          const own = this.ownWrites.get(rel)
          if (own && Date.now() - own < 1500) return
          onChange({ kind: 'file', path: rel })
        }, 150)
      )
    })
  }

  close(): void {
    this.watcher?.close()
    for (const t of this.debounce.values()) clearTimeout(t)
    this.debounce.clear()
  }
}

function collectTex(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'dir') collectTex(n.children ?? [], out)
    else if (n.name.endsWith('.tex')) out.push(n.path)
  }
  return out
}
