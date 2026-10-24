import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { latexmkEntries, parseLatexLog } from '@shared/logParser'
import type { CompileResult, Compiler } from '@shared/types'
import type { Project } from './project'

const ENGINE_FLAG: Record<Compiler, string> = {
  pdflatex: '-pdf',
  xelatex: '-pdfxe',
  lualatex: '-pdflua'
}

/** Apps launched from Finder get a minimal PATH, so add the usual TeX and Homebrew locations. */
const EXTRA_PATH = ['/Library/TeX/texbin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin']

const TIMEOUT_MS = 4 * 60 * 1000

export class CompileRunner {
  private child?: ChildProcess
  private cancelled = false

  async compile(project: Project): Promise<CompileResult> {
    this.stop()
    this.cancelled = false
    const started = Date.now()
    const { mainFile, compiler } = project.settings
    const mainAbs = project.resolve(mainFile)
    const jobname = path.basename(mainFile, path.extname(mainFile))
    const outDir = project.buildDir
    const pdfPath = path.join(outDir, `${jobname}.pdf`)
    const logPath = path.join(outDir, `${jobname}.log`)

    try {
      await fs.access(mainAbs)
    } catch {
      return failure(started, `Main file "${mainFile}" does not exist. Choose another one in Project settings.`)
    }

    await fs.mkdir(outDir, { recursive: true })
    // \include{dir/file} writes dir/file.aux into the output directory, which must already exist.
    await mirrorDirectories(project, path.dirname(mainAbs), outDir)

    const args = [
      ENGINE_FLAG[compiler] ?? '-pdf',
      '-f',
      '-interaction=nonstopmode',
      '-file-line-error',
      '-synctex=1',
      `-outdir=${outDir}`,
      path.basename(mainAbs)
    ]
    const env = {
      ...process.env,
      PATH: [...EXTRA_PATH, process.env.PATH ?? ''].join(':'),
      // Stop TeX from wrapping log lines at 79 columns, which makes the log parseable.
      max_print_line: '10000',
      error_line: '254',
      half_error_line: '238'
    }

    let output = ''
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn('latexmk', args, { cwd: path.dirname(mainAbs), env })
      this.child = child
      const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS)
      child.stdout.on('data', (d) => (output += d))
      child.stderr.on('data', (d) => (output += d))
      child.on('error', (err) => {
        output += `\n${err.message}`
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          output += '\nlatexmk was not found. Install MacTeX from https://tug.org/mactex/.'
        }
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    this.child = undefined

    const rawLog = await fs.readFile(logPath, 'utf8').catch(() => '')
    const entries = parseLatexLog(rawLog, { root: project.root, mainDir: project.relative(path.dirname(mainAbs)) })
    entries.push(...latexmkEntries(output))
    const hasPdf = await fs
      .access(pdfPath)
      .then(() => true)
      .catch(() => false)

    const hasErrors = entries.some((e) => e.level === 'error')
    return {
      status: this.cancelled ? 'cancelled' : exitCode === 0 && !hasErrors ? 'success' : 'failure',
      hasPdf,
      pdfPath: hasPdf ? pdfPath : undefined,
      entries,
      rawLog,
      output,
      durationMs: Date.now() - started
    }
  }

  stop(): void {
    if (this.child) {
      this.cancelled = true
      this.child.kill('SIGTERM')
    }
  }
}

async function mirrorDirectories(project: Project, srcDir: string, outDir: string): Promise<void> {
  const walk = async (dir: string): Promise<void> => {
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const d of dirents) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue
      const full = path.join(dir, d.name)
      await fs.mkdir(path.join(outDir, path.relative(srcDir, full)), { recursive: true })
      await walk(full)
    }
  }
  if (srcDir.startsWith(project.root)) await walk(srcDir)
}

function failure(started: number, message: string): CompileResult {
  return {
    status: 'failure',
    hasPdf: false,
    entries: [{ level: 'error', message }],
    rawLog: '',
    output: message,
    durationMs: Date.now() - started
  }
}
