import { useSyncExternalStore } from 'react'
import type { ThemePreference } from '@shared/types'
import { load, save } from './storage'

/** Per-machine editor preferences (project settings live in the project's .underleaf folder). */
export interface Prefs {
  theme: ThemePreference
  fontSize: number
  autoCompile: boolean
  spellCheck: boolean
  /** 'auto' detects each document's language; otherwise a macOS language code such as "en" or "de". */
  spellLanguage: string
  /** chktex style hints through texlab. */
  styleHints: boolean
  /** Code editor shows plain LaTeX; the visual editor renders it in place. */
  editorMode: 'code' | 'visual'
}

const DEFAULTS: Prefs = { theme: 'system', fontSize: 13.5, autoCompile: true, spellCheck: true, spellLanguage: 'auto', styleHints: false, editorMode: 'code' }

let current: Prefs = { ...DEFAULTS, ...load<Partial<Prefs>>('prefs', {}) }
const listeners = new Set<() => void>()
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

export function getPrefs(): Prefs {
  return current
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch }
  save('prefs', current)
  applyPrefs()
  for (const l of listeners) l()
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current
  )
}

export function effectiveTheme(): 'light' | 'dark' {
  return current.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : current.theme
}

/** Pushes preferences that are plain CSS or native settings onto the page and window. */
export function applyPrefs(): void {
  const root = document.documentElement
  root.dataset.theme = effectiveTheme()
  root.style.setProperty('--editor-font-size', `${current.fontSize}px`)
  window.underleaf.setTheme(current.theme)
}

darkQuery.addEventListener('change', () => {
  applyPrefs()
  for (const l of listeners) l()
})
