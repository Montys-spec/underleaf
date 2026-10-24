import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { LspOptions, LspStatus } from '@shared/types'
import { META_DIR } from './project'
import { findExecutable, runTool, TOOL_ENV } from './tools'

/**
 * Runs texlab for the open project and relays LSP messages to the renderer.
 * Server-to-client requests the editor's LSP client does not implement
 * (configuration, capability registration, progress) are answered here.
 */
export class TexlabBridge {
  private child?: ChildProcess
  private buffer = Buffer.alloc(0)
  private options: LspOptions = { chktex: false }
  private root = ''

  constructor(
    private bundledDir: string | undefined,
    private toRenderer: (message: string) => void
  ) {}

  async start(root: string, options: LspOptions): Promise<LspStatus> {
    this.stop()
    this.root = root
    this.options = options
    const exe = findExecutable('texlab', this.bundledDir)
    if (!exe) return { available: false, error: 'texlab is not installed. Install it with: brew install texlab' }
    const version = (await runTool(exe, ['--version'], { cwd: root, timeout: 5000 })).stdout.trim().replace(/^texlab\s*/, '')

    const child = spawn(exe, [], { cwd: root, env: TOOL_ENV, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.buffer = Buffer.alloc(0)
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk))
    child.stderr.on('data', () => {
      // texlab logs to stderr; nothing actionable for the user.
    })
    child.on('exit', () => {
      if (this.child === child) this.child = undefined
    })
    child.on('error', () => {
      if (this.child === child) this.child = undefined
    })
    return { available: true, version }
  }

  send(message: string): void {
    if (!this.child?.stdin?.writable) return
    const body = Buffer.from(message, 'utf8')
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.child.stdin.write(body)
  }

  stop(): void {
    const child = this.child
    this.child = undefined
    if (!child) return
    try {
      this.writeRaw(child, { jsonrpc: '2.0', id: 'shutdown', method: 'shutdown' })
      this.writeRaw(child, { jsonrpc: '2.0', method: 'exit' })
    } catch {
      // The process may already be gone.
    }
    setTimeout(() => child.kill(), 500)
  }

  private writeRaw(child: ChildProcess, msg: unknown): void {
    const body = Buffer.from(JSON.stringify(msg), 'utf8')
    child.stdin?.write(`Content-Length: ${body.length}\r\n\r\n`)
    child.stdin?.write(body)
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1])
      if (!Number.isFinite(length)) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      if (this.buffer.length < headerEnd + 4 + length) return
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')
      this.buffer = this.buffer.subarray(headerEnd + 4 + length)
      this.handle(body)
    }
  }

  private handle(body: string): void {
    let msg: { id?: number | string; method?: string; params?: { items?: unknown[] } }
    try {
      msg = JSON.parse(body)
    } catch {
      return
    }
    if (msg.method && msg.id !== undefined) {
      if (msg.method === 'workspace/configuration') {
        const items = msg.params?.items ?? [{}]
        this.reply(msg.id, items.map(() => this.settings()))
        return
      }
      if (['client/registerCapability', 'client/unregisterCapability', 'window/workDoneProgress/create', 'window/showMessageRequest'].includes(msg.method)) {
        this.reply(msg.id, null)
        return
      }
    }
    if (msg.method === '$/progress' || msg.method === 'window/logMessage') return
    if (msg.id === 'shutdown') return
    this.toRenderer(body)
  }

  private reply(id: number | string, result: unknown): void {
    this.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }

  /** texlab settings, see https://github.com/latex-lsp/texlab/wiki/Configuration */
  private settings(): unknown {
    return {
      build: {
        // texlab reads .aux files from here to show label numbers; its log parsing is
        // pointed at a folder without logs, since Underleaf reports compile errors itself.
        auxDirectory: path.join(this.root, META_DIR, 'build'),
        logDirectory: path.join(this.root, META_DIR, 'no-logs'),
        pdfDirectory: path.join(this.root, META_DIR, 'build'),
        onSave: false,
        forwardSearchAfter: false
      },
      chktex: { onOpenAndSave: this.options.chktex, onEdit: false },
      diagnosticsDelay: 300,
      latexFormatter: 'latexindent',
      latexindent: { modifyLineBreaks: false },
      bibtexFormatter: 'texlab',
      formatterLineLength: 100,
      completion: { matcher: 'fuzzy-ignore-case' }
    }
  }
}
