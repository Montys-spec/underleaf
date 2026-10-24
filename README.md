# Underleaf

A local, Overleaf-style LaTeX editor for macOS: file tree, editor and live PDF side by side, compiled
with your own TeX installation. No account, no subscription, your files stay where they are.

## Features

- **Projects are folders.** Open any folder, or start from a template: article, paper with
  bibliography, thesis with chapters, Beamer slides, problem set, letter.
- **Compile like Overleaf.** `latexmk` with pdfLaTeX, XeLaTeX or LuaLaTeX; BibTeX/Biber run
  automatically. Auto-compile after you stop typing, or press ⌘S / ⌘↵. "Recompile from scratch"
  clears the cache.
- **Readable errors.** The TeX log becomes clickable cards (errors, warnings, bad boxes), and the
  lines are underlined in the editor.
- **PDF viewer.** Zoom, selectable text, clickable links and cross-references, export, open in Preview.
- **SyncTeX.** Double-click the PDF to jump to the source; ⌘J shows the cursor's spot in the PDF.
- **Smart editing with [texlab](https://github.com/latex-lsp/texlab).** Completion of commands,
  environments, `\ref` labels (with their numbers), `\cite` keys and file names; hover previews of
  citations and labels; go to definition (F12), find references (⇧F12), rename (F2), format
  (⇧⌥F); optional chktex style hints. Without texlab, Underleaf falls back to its own completion.
- **Spell checking** with macOS dictionaries, LaTeX-aware (skips commands, math, labels), with the
  language detected per document (e.g. English or German). Right-click for suggestions.
- **File outline, project-wide search and replace, word count** (texcount).
- **Source control.** Initialise a git repository, see changes and diffs, commit, push and pull.
- **Light and dark themes**, following macOS by default.

## Requirements

- macOS 11 or newer with [MacTeX](https://tug.org/mactex/) (provides `latexmk`, `synctex`,
  `texcount`, `biber`)
- Optional: texlab (`brew install texlab`) for the smart editing features
- To build: Node.js 20+ and Xcode Command Line Tools (`xcode-select --install`, for `swiftc`)

## Build and install

```bash
npm install
npm run package          # builds dist/mac/Underleaf.app
```

Drag `dist/mac/Underleaf.app` into `/Applications`. The app is not signed, so the first time
right-click it and choose **Open**.

For development with hot reload: `npm run dev`. To open a folder directly on launch, set
`UNDERLEAF_OPEN=/path/to/project`. Tests: `npm test`; type checks: `npm run typecheck`.

## How it works

- Underleaf adds a hidden `.underleaf/` folder to each project holding `settings.json` (main
  document, compiler) and the build output, and git-ignores it automatically.
- Compiling runs `latexmk -f -interaction=nonstopmode -file-line-error -synctex=1` with the output
  in `.underleaf/build`, so your project folder stays clean.
- Edits autosave after a second of inactivity. Files changed by other programs reload automatically
  (unless you have unsaved edits in that file).
- Spell checking runs through `underleaf-spell`, a small Swift helper (`native/spell.swift`) built
  as a universal binary by `npm run native` and shipped inside the app.

| Shortcut | Action |
| --- | --- |
| ⌘S / ⌘↵ | Save and recompile |
| ⌘J | Show cursor position in the PDF |
| Double-click PDF | Jump to the source line |
| ⌘L | Toggle logs |
| ⇧⌘F | Search the project |
| ⇧⌘G | Source control |
| ⇧⌘O | Toggle file outline |
| ⇧⌘C | Word count |
| ⇧⌘E | Export PDF |
| ⌘B / ⌘I | Wrap selection in `\textbf{}` / `\textit{}` |
| ⌘/ | Toggle comment |
| ⌘F | Find and replace in the file |
| F12 / ⇧F12 / F2 | Go to definition / find references / rename (texlab) |
| ⇧⌥F | Format document with latexindent (texlab) |
| ⌘= / ⌘− / ⌘0 | Zoom PDF in / out / fit width |
| ⌘N / ⌘O / ⌘, | New file / open project / settings |

## Project layout

```
src/main/       Electron main process: window, menus, files, latexmk, SyncTeX, git, texlab bridge
src/preload/    The narrow API the UI is allowed to call (window.underleaf)
src/shared/     Types, TeX log parser and LaTeX scanners (unit tested)
src/renderer/   React UI: sidebar panels, CodeMirror editor, pdf.js viewer, dialogs
native/         The Swift spell-check helper
test/           node --test suites (npm test)
```
