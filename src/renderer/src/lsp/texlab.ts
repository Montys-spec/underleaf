import {
  findReferencesKeymap,
  formatKeymap,
  hoverTooltips,
  jumpToDefinitionKeymap,
  LSPClient,
  LSPPlugin,
  renameKeymap,
  Workspace,
  type Transport,
  type WorkspaceFile
} from '@codemirror/lsp-client'
import type { Extension, Text } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import type { LspOptions, LspStatus } from '@shared/types'

export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  message: string
  source?: string
}

const api = window.underleaf

type WorkspaceFileUpdate = ReturnType<Workspace['syncFiles']>[number]

export function pathToUri(absPath: string): string {
  return 'file://' + absPath.split('/').map(encodeURIComponent).join('/')
}

export function uriToPath(uri: string): string {
  return decodeURIComponent(new URL(uri).pathname)
}

let transport: Transport | null = null

/** One IPC transport for the window; texlab restarts reuse it. */
function ipcTransport(): Transport {
  if (transport) return transport
  const handlers = new Set<(msg: string) => void>()
  api.onLspMessage((msg) => {
    for (const h of handlers) h(msg)
  })
  transport = {
    send: (msg) => api.lspSend(msg),
    subscribe: (h) => handlers.add(h),
    unsubscribe: (h) => handlers.delete(h)
  }
  return transport
}

class File implements WorkspaceFile {
  constructor(
    public uri: string,
    public languageId: string,
    public version: number,
    public doc: Text,
    public view: EditorView
  ) {}
  getView(): EditorView {
    return this.view
  }
}

/**
 * Underleaf shows every file in one editor view and swaps its state between tabs,
 * so files open and close as tabs are activated. Jumping to another file
 * (go to definition, references) goes through the app's own tab handling.
 */
class UnderleafWorkspace extends Workspace {
  files: File[] = []
  private versions = new Map<string, number>()
  static displayFile: (uri: string) => Promise<EditorView | null> = async () => null

  private nextVersion(uri: string): number {
    const v = (this.versions.get(uri) ?? -1) + 1
    this.versions.set(uri, v)
    return v
  }

  syncFiles(): readonly WorkspaceFileUpdate[] {
    const result: WorkspaceFileUpdate[] = []
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view)
      if (!plugin || plugin.uri !== file.uri) continue
      const changes = plugin.unsyncedChanges
      if (!changes.empty) {
        result.push({ changes, file, prevDoc: file.doc })
        file.doc = file.view.state.doc
        file.version = this.nextVersion(file.uri)
        plugin.clear()
      }
    }
    return result
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    this.closeFile(uri)
    const file = new File(uri, languageId, this.nextVersion(uri), view.state.doc, view)
    this.files.push(file)
    this.client.didOpen(file)
  }

  closeFile(uri: string): void {
    const file = this.getFile(uri)
    if (!file) return
    this.files = this.files.filter((f) => f !== file)
    this.client.didClose(uri)
  }

  displayFile(uri: string): Promise<EditorView | null> {
    return UnderleafWorkspace.displayFile(uri)
  }
}

export class TexlabClient {
  private client: LSPClient | null = null
  status: LspStatus = { available: false }

  constructor(
    private root: string,
    private onDiagnostics: (absPath: string, diagnostics: LspDiagnostic[]) => void,
    displayFile: (absPath: string) => Promise<EditorView | null>
  ) {
    UnderleafWorkspace.displayFile = (uri) => displayFile(uriToPath(uri))
  }

  get active(): boolean {
    return this.client !== null
  }

  async start(opts: LspOptions): Promise<LspStatus> {
    this.status = await api.lspStart(opts)
    if (!this.status.available) return this.status
    const client = new LSPClient({
      rootUri: pathToUri(this.root),
      workspace: (c) => new UnderleafWorkspace(c),
      timeout: 8000,
      extensions: [
        hoverTooltips(),
        keymap.of([...jumpToDefinitionKeymap, ...findReferencesKeymap, ...formatKeymap, ...renameKeymap]),
        { clientCapabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: false } } } }
      ],
      notificationHandlers: {
        'textDocument/publishDiagnostics': (_c, params: { uri: string; diagnostics: LspDiagnostic[] }) => {
          this.onDiagnostics(uriToPath(params.uri), params.diagnostics)
          return true
        }
      }
    })
    client.connect(ipcTransport())
    try {
      await client.initializing
    } catch (err) {
      this.status = { available: false, error: `texlab failed to start: ${String((err as Error)?.message ?? err)}` }
      return this.status
    }
    this.client = client
    return this.status
  }

  /** Re-reads settings (e.g. after toggling style hints). texlab pulls them via workspace/configuration. */
  async reconfigure(opts: LspOptions): Promise<void> {
    if (!this.client) return
    await api.lspStart(opts)
    // Restarting is the simplest reliable way to apply new settings; reconnect the client.
    this.client.disconnect()
    this.client.connect(ipcTransport())
    await this.client.initializing
  }

  /** The editor extension that connects a file to texlab, or nothing for other file types. */
  extensionFor(absPath: string): Extension {
    if (!this.client) return []
    const languageId = /\.bib$/i.test(absPath) ? 'bibtex' : /\.(tex|sty|cls|ltx)$/i.test(absPath) ? 'latex' : null
    if (!languageId) return []
    return this.client.plugin(pathToUri(absPath), languageId)
  }

  stop(): void {
    this.client?.disconnect()
    this.client = null
  }
}
