import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (err: Error) => void }

/**
 * Talks to the bundled `underleaf-spell` helper, which wraps macOS's NSSpellChecker
 * (the same dictionaries and learned words as the rest of the system).
 */
export class SpellService {
  private child?: ChildProcess
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor(private binDir: string) {}

  get available(): boolean {
    return existsSync(this.exe)
  }

  private get exe(): string {
    return path.join(this.binDir, 'underleaf-spell')
  }

  private ensure(): ChildProcess {
    if (this.child && this.child.exitCode === null) return this.child
    const child = spawn(this.exe, [], { stdio: ['pipe', 'pipe', 'ignore'] })
    createInterface({ input: child.stdout! }).on('line', (line) => {
      try {
        const msg = JSON.parse(line) as Record<string, unknown> & { id: number }
        this.pending.get(msg.id)?.resolve(msg)
        this.pending.delete(msg.id)
      } catch {
        // Ignore malformed lines.
      }
    })
    const failAll = (err: Error) => {
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      if (this.child === child) this.child = undefined
    }
    child.on('exit', () => failAll(new Error('spell helper exited')))
    child.on('error', (err) => failAll(err))
    this.child = child
    return child
  }

  private request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.available) return Promise.reject(new Error('Spell checking helper is missing.'))
    const id = this.nextId++
    const child = this.ensure()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.stdin!.write(JSON.stringify({ id, ...payload }) + '\n')
    })
  }

  async check(words: string[], lang: string | null): Promise<string[]> {
    if (!words.length) return []
    return ((await this.request({ cmd: 'check', words, lang })).misspelled as string[]) ?? []
  }

  async suggest(word: string, lang: string | null): Promise<string[]> {
    return ((await this.request({ cmd: 'suggest', word, lang })).suggestions as string[]) ?? []
  }

  async learn(word: string): Promise<void> {
    await this.request({ cmd: 'learn', word })
  }

  async detect(text: string): Promise<string | null> {
    return ((await this.request({ cmd: 'detect', text })).lang as string | null) ?? null
  }

  async languages(): Promise<string[]> {
    return ((await this.request({ cmd: 'languages' })).languages as string[]) ?? []
  }

  stop(): void {
    this.child?.kill()
    this.child = undefined
  }
}
