import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseBibEntries, findLabels } from '@shared/texScan'
import type { FileNode, ProjectSymbols, SearchFileResult, SearchOptions, WordCount } from '@shared/types'
import type { Project } from './project'
import { runTool } from './tools'

const TEXT_EXT = /\.(tex|bib|sty|cls|txt|md|bst|bbx|cbx|ltx|dtx|ins|cfg|def|tikz)$/i
const MAX_SEARCH_RESULTS = 2000

function allFiles(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'dir') allFiles(n.children ?? [], out)
    else out.push(n.path)
  }
  return out
}

export async function wordCount(project: Project): Promise<WordCount> {
  const main = project.resolve(project.settings.mainFile)
  const { stdout, stderr, code } = await runTool('texcount', ['-inc', '-utf8', '-brief', main], { cwd: path.dirname(main) })
  if (code !== 0 && !stdout) throw new Error(stderr || 'texcount failed. It is part of MacTeX; make sure MacTeX is installed.')
  const line = /^(\d+)\+(\d+)\+(\d+) \((\d+)\/(\d+)\/(\d+)\/(\d+)\) (File\(s\) total|File|Included file): (.*)$/
  const files: WordCount['files'] = []
  let total: number[] | null = null
  for (const l of stdout.split('\n')) {
    const m = line.exec(l.trim())
    if (!m) continue
    const nums = m.slice(1, 8).map(Number)
    if (m[8] === 'File(s) total') total = nums
    else files.push({ file: project.relative(path.resolve(path.dirname(main), m[9].trim())), words: nums[0] })
  }
  // A single file has no "total" line; its own line is the total.
  if (!total) {
    const m = line.exec(stdout.split('\n').find((l) => line.test(l.trim()))?.trim() ?? '')
    total = m ? m.slice(1, 8).map(Number) : [0, 0, 0, 0, 0, 0, 0]
  }
  return { words: total[0], headers: total[1], captions: total[2], mathInline: total[5], mathDisplay: total[6], files }
}

export function buildMatcher(opts: SearchOptions): RegExp {
  let source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (opts.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  return new RegExp(source, `gu${opts.caseSensitive ? '' : 'i'}`)
}

export async function searchProject(project: Project, opts: SearchOptions): Promise<SearchFileResult[]> {
  if (!opts.query) return []
  const re = buildMatcher(opts)
  const results: SearchFileResult[] = []
  let total = 0
  for (const file of allFiles(await project.readTree())) {
    if (!TEXT_EXT.test(file)) continue
    const text = await fs.readFile(project.resolve(file), 'utf8').catch(() => null)
    if (text === null) continue
    const matches: SearchFileResult['matches'] = []
    const lines = text.split('\n')
    lines.forEach((lineText, i) => {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(lineText)) && total < MAX_SEARCH_RESULTS) {
        if (m[0].length === 0) {
          re.lastIndex++
          continue
        }
        // Keep previews short but show some context before the match.
        const previewOffset = Math.max(0, m.index - 40)
        matches.push({ line: i + 1, column: m.index, length: m[0].length, preview: lineText.slice(previewOffset, previewOffset + 160), previewOffset })
        total++
      }
    })
    if (matches.length) results.push({ file, matches })
    if (total >= MAX_SEARCH_RESULTS) break
  }
  return results
}

export async function replaceInProject(project: Project, opts: SearchOptions, replacement: string): Promise<{ files: string[]; replacements: number }> {
  const re = buildMatcher(opts)
  const changed: string[] = []
  let replacements = 0
  for (const file of allFiles(await project.readTree())) {
    if (!TEXT_EXT.test(file)) continue
    const full = project.resolve(file)
    const text = await fs.readFile(full, 'utf8').catch(() => null)
    if (text === null) continue
    let count = 0
    const next = text.replace(re, (...args) => {
      count++
      // With regex search, `$1` etc. in the replacement refer to capture groups.
      if (!opts.regex) return replacement
      const groups = args.slice(1, -2) as string[]
      return replacement.replace(/\$(\d)/g, (_, n) => groups[Number(n) - 1] ?? '')
    })
    if (count > 0) {
      project.markOwnWrite(file)
      await fs.writeFile(full, next, 'utf8')
      changed.push(file)
      replacements += count
    }
  }
  return { files: changed, replacements }
}

/** Labels, bibliography keys and file names, for completion when texlab is not available. */
export async function projectSymbols(project: Project): Promise<ProjectSymbols> {
  const files = allFiles(await project.readTree())
  const symbols: ProjectSymbols = { labels: [], citations: [], files }
  for (const file of files) {
    if (file.endsWith('.tex')) {
      const text = await fs.readFile(project.resolve(file), 'utf8').catch(() => '')
      symbols.labels.push(...findLabels(text).map((l) => ({ ...l, file })))
    } else if (file.endsWith('.bib')) {
      const text = await fs.readFile(project.resolve(file), 'utf8').catch(() => '')
      symbols.citations.push(...parseBibEntries(text))
    }
  }
  return symbols
}
