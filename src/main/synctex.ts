import { execFile } from 'node:child_process'
import path from 'node:path'
import type { SyncTexBox, SyncTexSource } from '@shared/types'
import { TOOL_ENV } from './tools'

function run(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('synctex', args, { cwd, env: TOOL_ENV, timeout: 10_000 }, (err, stdout) => {
      if (err && !stdout) reject(err)
      else resolve(stdout)
    })
  })
}

/** Source position → boxes in the PDF (page coordinates in PDF points, origin top-left). */
export async function forwardSearch(pdf: string, file: string, line: number, column: number): Promise<SyncTexBox[]> {
  const out = await run(['view', '-i', `${line}:${Math.max(column, 0)}:${file}`, '-o', pdf], path.dirname(file))
  const boxes: SyncTexBox[] = []
  let cur: Partial<SyncTexBox> = {}
  for (const l of out.split('\n')) {
    const m = /^(Page|h|v|W|H):(.*)$/.exec(l.trim())
    if (!m) continue
    const value = Number(m[2])
    if (m[1] === 'Page') {
      cur = { page: value }
    } else {
      cur[m[1] as 'h' | 'v' | 'W' | 'H'] = value
      if (m[1] === 'H' && cur.page !== undefined) {
        boxes.push(cur as SyncTexBox)
        cur = { page: cur.page }
      }
    }
  }
  return boxes
}

/** PDF position → absolute source file and line. */
export async function inverseSearch(pdf: string, page: number, x: number, y: number): Promise<SyncTexSource | null> {
  const out = await run(['edit', '-o', `${page}:${x}:${y}:${pdf}`], path.dirname(pdf))
  const input = /^Input:(.*)$/m.exec(out)?.[1]
  const line = Number(/^Line:(-?\d+)$/m.exec(out)?.[1])
  const column = Number(/^Column:(-?\d+)$/m.exec(out)?.[1])
  if (!input || !(line > 0)) return null
  return { file: path.resolve(input.trim()), line, column: column > 0 ? column : undefined }
}
