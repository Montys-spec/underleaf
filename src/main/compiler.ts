import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { latexmkEntries, parseLatexLog } from '@shared/logParser'
import { compileHints } from '@shared/texScan'
import type { CompileResult, Compiler } from '@shared/types'
import type { Project } from './project'
import { TOOL_ENV } from './tools'

const ENGINE_FLAG: Record<Compiler, string> = {
  pdflatex: '-pdf',
  xelatex: '-pdfxe',
  lualatex: '-pdflua'
}

const TIMEOUT_MS = 4 * 60 * 1000

export class CompileRunner {
  private child?: ChildProcess
  private cancelled = false

  async compile(project: Project, activeFile?: string, savePdf = false): Promise<CompileResult> {
    this.stop()
    this.cancelled = false
    const started = Date.now()
    const { mainFile, compiler } = await resolveTarget(project, activeFile)
    const mainAbs = project.resolve(mainFile)
    const jobname = path.basename(mainFile, path.extname(mainFile))
    const outDir = project.buildDir
    const pdfPath = path.join(outDir, `${jobname}.pdf`)
    const logPath = path.join(outDir, `${jobname}.log`)

    try {
      await fs.access(mainAbs)
    } catch {
      return failure(started, mainFile, compiler, `Main file "${mainFile}" does not exist. Choose another one in Project settings.`)
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
      ...TOOL_ENV,
      // Stop TeX from wrapping log lines at 79 columns, which makes the log parseable.
      max_print_line: '10000',
      error_line: '254',
      half_error_line: '238',
      // Don't let TeX try to generate missing fonts. Checks such as \IfFontExistsTF{Calibri}
      // otherwise run mktextfm, which takes many seconds per font and can drop junk
      // folders into the project.
      MKTEXTFM: '0',
      MKTEXMF: '0'
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
    const status = this.cancelled ? 'cancelled' : exitCode === 0 && !hasErrors ? 'success' : 'failure'
    // Keep a copy beside the source, like a normal LaTeX setup. Only clean builds overwrite it,
    // so a broken compile never replaces the last good PDF.
    let savedPdf: string | undefined
    if (savePdf && hasPdf && status === 'success') {
      const target = path.join(path.dirname(mainAbs), `${jobname}.pdf`)
      try {
        await fs.copyFile(pdfPath, target)
        savedPdf = project.relative(target)
      } catch (err) {
        entries.push({ level: 'warning', message: `Could not save the PDF next to ${mainFile}: ${(err as Error).message}` })
      }
    }
    return {
      status,
      hasPdf,
      pdfPath: hasPdf ? pdfPath : undefined,
      entries,
      rawLog,
      output,
      durationMs: Date.now() - started,
      mainFile,
      compiler,
      savedPdf
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

/**
 * Which document to build, and with which engine. A project folder can hold several complete
 * documents (a CV and a cover letter per application), so the open file is compiled when it is
 * one, or when it names its root with `% !TEX root`. Otherwise the project's main file is used.
 * `% !TEX program`, or packages such as fontspec that only work with XeLaTeX or LuaLaTeX,
 * override the project's engine.
 */
export async function resolveTarget(project: Project, activeFile?: string): Promise<{ mainFile: string; compiler: Compiler }> {
  const read = (rel: string) => fs.readFile(project.resolve(rel), 'utf8').then(compileHints, () => null)
  let mainFile = project.settings.mainFile
  if (activeFile?.endsWith('.tex')) {
    const hints = await read(activeFile)
    if (hints?.root) {
      const root = project.relative(path.resolve(path.dirname(project.resolve(activeFile)), hints.root))
      if (!root.startsWith('..')) mainFile = root
    } else if (hints?.standalone) mainFile = activeFile
  }
  const hints = await read(mainFile)
  const fallback = project.settings.compiler
  const compiler = hints?.engine ?? (hints?.needsUnicodeEngine && fallback === 'pdflatex' ? 'xelatex' : fallback)
  return { mainFile, compiler }
}

function failure(started: number, mainFile: string, compiler: Compiler, message: string): CompileResult {
  return {
    status: 'failure',
    hasPdf: false,
    entries: [{ level: 'error', message }],
    rawLog: '',
    output: message,
    durationMs: Date.now() - started,
    mainFile,
    compiler
  }
}
