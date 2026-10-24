export type Compiler = 'pdflatex' | 'xelatex' | 'lualatex'

export interface ProjectSettings {
  /** Path of the root document, relative to the project root. */
  mainFile: string
  compiler: Compiler
}

export interface FileNode {
  name: string
  /** Path relative to the project root, always using `/`. */
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
}

export interface ProjectInfo {
  root: string
  name: string
  settings: ProjectSettings
  tree: FileNode[]
  texFiles: string[]
}

export interface RecentProject {
  root: string
  name: string
  openedAt: number
}

export type LogLevel = 'error' | 'warning' | 'typesetting'

export interface LogEntry {
  level: LogLevel
  message: string
  /** Project-relative file path, when the entry can be tied to a file. */
  file?: string
  line?: number
  /** Extra context lines from the log, e.g. the `l.12 ...` excerpt. */
  context?: string
}

export interface CompileResult {
  status: 'success' | 'failure' | 'cancelled'
  /** True when a PDF exists after this run (it may still contain errors). */
  hasPdf: boolean
  pdfPath?: string
  entries: LogEntry[]
  rawLog: string
  /** Output of latexmk itself (stdout + stderr). */
  output: string
  durationMs: number
}

export type FsChangeEvent = { kind: 'tree' } | { kind: 'file'; path: string }

export interface UnderleafApi {
  getRecentProjects(): Promise<RecentProject[]>
  openProjectDialog(): Promise<ProjectInfo | null>
  newProjectDialog(): Promise<ProjectInfo | null>
  openProject(root: string): Promise<ProjectInfo>
  getInitialProject(): Promise<ProjectInfo | null>
  closeProject(): Promise<void>
  refreshProject(): Promise<ProjectInfo>

  readFile(path: string): Promise<string>
  readBinary(path: string): Promise<Uint8Array>
  writeFile(path: string, content: string): Promise<void>
  createFile(path: string): Promise<void>
  createFolder(path: string): Promise<void>
  renamePath(from: string, to: string): Promise<void>
  trashPath(path: string): Promise<void>
  /** Copies files into the project; shows a file picker when no sources are given. */
  importFiles(targetDir: string, sources?: string[]): Promise<string[]>
  getPathForFile(file: File): string
  revealInFinder(path: string): Promise<void>

  saveSettings(settings: ProjectSettings): Promise<ProjectSettings>
  compile(): Promise<CompileResult>
  stopCompile(): Promise<void>
  readPdf(): Promise<Uint8Array | null>
  openPdfExternally(): Promise<void>

  onFsChange(cb: (e: FsChangeEvent) => void): () => void
  onMenu(cb: (command: MenuCommand) => void): () => void
}

export type MenuCommand =
  | 'compile'
  | 'save'
  | 'open-project'
  | 'new-project'
  | 'close-project'
  | 'new-file'
  | 'settings'
  | 'toggle-logs'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'reload-project'
