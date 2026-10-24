import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** Apps launched from Finder get a minimal PATH, so add the usual TeX and Homebrew locations. */
export const EXTRA_PATH = ['/Library/TeX/texbin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin']

export const TOOL_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: [...EXTRA_PATH, process.env.PATH ?? ''].join(':')
}

/** Finds an executable on the extended PATH, preferring a copy bundled with the app. */
export function findExecutable(name: string, bundledDir?: string): string | null {
  const dirs = [...(bundledDir ? [bundledDir] : []), ...(TOOL_ENV.PATH ?? '').split(':')]
  for (const dir of dirs) {
    if (!dir) continue
    const full = path.join(dir, name)
    if (existsSync(full)) return full
  }
  return null
}

export function runTool(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout?: number; input?: string }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd: opts.cwd, env: TOOL_ENV, timeout: opts.timeout ?? 30_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0
      resolve({ stdout: String(stdout), stderr: String(stderr || (err && !stdout ? err.message : '')), code })
    })
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input)
    }
  })
}
