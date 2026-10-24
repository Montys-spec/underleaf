import type { GitStatus } from '@shared/types'
import { findExecutable, runTool } from './tools'

async function git(root: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout, stderr, code } = await runTool('git', args, { cwd: root, timeout })
  if (code !== 0) throw new Error((stderr || stdout).trim() || `git ${args[0]} failed`)
  return stdout
}

export async function gitStatus(root: string): Promise<GitStatus> {
  const empty: GitStatus = { available: false, isRepo: false, changes: [], commits: [], hasRemote: false, ahead: 0, behind: 0 }
  if (!findExecutable('git')) return empty
  const inside = await runTool('git', ['rev-parse', '--show-toplevel'], { cwd: root })
  if (inside.code !== 0) return { ...empty, available: true }

  const status = await git(root, ['status', '--porcelain=v1', '-b', '--untracked-files=all', '--', '.'])
  const lines = status.split('\n').filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
  const branch = head.replace(/^No commits yet on /, '').split('...')[0].trim()
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
  // Porcelain paths are relative to the repository root, which may be above the project folder.
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim()
  const changes = lines
    .map((l) => ({ status: l.slice(0, 2), path: l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()! }))
    .map((c) => ({ ...c, path: c.path.startsWith(prefix) ? c.path.slice(prefix.length) : c.path }))
    .filter((c) => !c.path.startsWith('.underleaf/'))

  const log = await runTool('git', ['log', '-n', '40', '--format=%H%x1f%s%x1f%an%x1f%at'], { cwd: root })
  const commits =
    log.code === 0
      ? log.stdout
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const [hash, subject, author, date] = l.split('\x1f')
            return { hash, subject, author, date: Number(date) * 1000 }
          })
      : []
  const remotes = await runTool('git', ['remote'], { cwd: root })
  return { available: true, isRepo: true, branch, changes, commits, hasRemote: remotes.stdout.trim().length > 0, ahead, behind }
}

export async function gitInit(root: string): Promise<void> {
  await git(root, ['init'])
}

export async function gitCommit(root: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('Write a short message describing the changes.')
  await git(root, ['add', '-A', '--', '.'])
  await git(root, ['commit', '-m', message])
}

export async function gitDiff(root: string, file: string): Promise<string> {
  const tracked = await runTool('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root })
  if (tracked.code !== 0) {
    // New files have no diff against HEAD; show their whole content as added.
    const { stdout } = await runTool('git', ['diff', '--no-index', '--', '/dev/null', file], { cwd: root })
    return stdout
  }
  return git(root, ['diff', 'HEAD', '--', file])
}

export async function gitPush(root: string): Promise<string> {
  const { stdout, stderr, code } = await runTool('git', ['push'], { cwd: root, timeout: 120_000 })
  if (code !== 0) throw new Error(stderr.trim() || 'git push failed')
  return (stdout + stderr).trim()
}

export async function gitPull(root: string): Promise<string> {
  const { stdout, stderr, code } = await runTool('git', ['pull', '--ff-only'], { cwd: root, timeout: 120_000 })
  if (code !== 0) throw new Error(stderr.trim() || 'git pull failed')
  return (stdout + stderr).trim()
}
