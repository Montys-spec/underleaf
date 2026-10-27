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
  /** The document that was built: the open file when it is a complete document, else the main file. */
  mainFile: string
  /** The engine used, after `% !TEX program` and package checks. */
  compiler: Compiler
}

export interface SyncTexBox {
  page: number
  /** Box position and size in PDF points, origin at the page's top-left; v is the baseline. */
  h: number
  v: number
  W: number
  H: number
}

export interface SyncTexSource {
  /** Project-relative path. */
  file: string
  line: number
  column?: number
}

export interface WordCount {
  words: number
  headers: number
  captions: number
  mathInline: number
  mathDisplay: number
  files: { file: string; words: number }[]
}

export interface SearchOptions {
  query: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}

export interface SearchMatch {
  line: number
  /** 0-based column of the match within the line. */
  column: number
  length: number
  /** The (possibly trimmed) line text, and where it starts within the original line. */
  preview: string
  previewOffset: number
}

export interface SearchFileResult {
  file: string
  matches: SearchMatch[]
}

export interface GitChange {
  path: string
  /** Two-letter porcelain status, e.g. ' M', '??', 'A '. */
  status: string
}

export interface GitCommit {
  hash: string
  subject: string
  author: string
  date: number
}

export interface GitStatus {
  available: boolean
  isRepo: boolean
  branch?: string
  changes: GitChange[]
  commits: GitCommit[]
  hasRemote: boolean
  ahead: number
  behind: number
}

export interface LabelSymbol {
  name: string
  file: string
  line: number
}

export interface CitationSymbol {
  key: string
  type: string
  title?: string
  author?: string
  year?: string
}

export interface ProjectSymbols {
  labels: LabelSymbol[]
  citations: CitationSymbol[]
  files: string[]
}

export interface TemplateInfo {
  id: string
  name: string
  description: string
}

export interface LspStatus {
  available: boolean
  version?: string
  error?: string
}

export interface LspOptions {
  /** Run chktex style checks when files are opened and saved. */
  chktex: boolean
}

export type ThemePreference = 'system' | 'light' | 'dark'

export type FsChangeEvent = { kind: 'tree' } | { kind: 'file'; path: string }

export interface UnderleafApi {
  getRecentProjects(): Promise<RecentProject[]>
  openProjectDialog(): Promise<ProjectInfo | null>
  newProjectDialog(templateId?: string): Promise<ProjectInfo | null>
  listTemplates(): Promise<TemplateInfo[]>
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
  /** Builds `activeFile` if it is a complete document (or names its root), else the main file. */
  compile(activeFile?: string): Promise<CompileResult>
  stopCompile(): Promise<void>
  /** Deletes the build folder so the next compile starts from scratch. */
  clearCache(): Promise<void>
  readPdf(): Promise<Uint8Array | null>
  openPdfExternally(): Promise<void>
  exportPdf(): Promise<string | null>
  syncForward(file: string, line: number, column: number): Promise<SyncTexBox[]>
  syncInverse(page: number, x: number, y: number): Promise<SyncTexSource | null>

  wordCount(): Promise<WordCount>
  search(opts: SearchOptions): Promise<SearchFileResult[]>
  replaceAll(opts: SearchOptions, replacement: string): Promise<{ files: string[]; replacements: number }>
  getSymbols(): Promise<ProjectSymbols>

  gitStatus(): Promise<GitStatus>
  gitInit(): Promise<void>
  gitCommit(message: string): Promise<void>
  gitDiff(path: string): Promise<string>
  gitPush(): Promise<string>
  gitPull(): Promise<string>

  lspStart(opts: LspOptions): Promise<LspStatus>
  lspSend(message: string): void
  onLspMessage(cb: (message: string) => void): () => void

  /** Spelling through macOS's spell checker; `lang` null means the system's default language. */
  spellCheck(words: string[], lang: string | null): Promise<string[]>
  spellSuggest(word: string, lang: string | null): Promise<string[]>
  spellLearn(word: string): Promise<void>
  spellDetect(text: string): Promise<string | null>
  spellLanguages(): Promise<string[]>
  setTheme(theme: ThemePreference): void

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
  | 'word-count'
  | 'search'
  | 'export-pdf'
  | 'sync-to-pdf'
  | 'toggle-outline'
  | 'git'
