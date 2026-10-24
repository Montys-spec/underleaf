# Underleaf

A local, Overleaf-style LaTeX editor for macOS: file tree, editor and live PDF side by side, compiled
with your own TeX installation. No account, no subscription, your files stay where they are.

## Requirements

- macOS with [MacTeX](https://tug.org/mactex/) (provides `latexmk`, `pdflatex`, `xelatex`, `lualatex`, `biber`)
- Node.js 20+ (only to build the app)

## Use it

```bash
npm install
npm run package          # builds dist/mac/Underleaf.app
```

Drag `dist/mac/Underleaf.app` into `/Applications`. The app is unsigned, so the first time
right-click it and choose **Open**.

For development with hot reload: `npm run dev`. To open a folder directly on launch, set
`UNDERLEAF_OPEN=/path/to/project`.

## How it works

- Any folder is a project. Underleaf adds a hidden `.underleaf/` folder holding `settings.json`
  (main document, compiler) and the build output, and git-ignores it automatically.
- Compiling runs `latexmk -f -interaction=nonstopmode -file-line-error -synctex=1` with the
  output in `.underleaf/build`, so your project folder stays clean. BibTeX/Biber run automatically.
- Edits autosave after a second of inactivity. Files changed by other programs reload automatically
  (unless you have unsaved edits in that file).

| Shortcut | Action |
| --- | --- |
| ⌘S / ⌘↵ | Save and recompile |
| ⌘L | Toggle logs |
| ⌘B / ⌘I | Wrap selection in `\textbf{}` / `\textit{}` |
| ⌘/ | Toggle comment |
| ⌘F | Find and replace |
| ⌘= / ⌘− / ⌘0 | Zoom PDF in / out / fit width |
| ⌘N / ⌘O / ⌘, | New file / open project / project settings |

## Project layout

```
src/main/       Electron main process: window, menus, file system, latexmk runner
src/preload/    The narrow API the UI is allowed to call (window.underleaf)
src/shared/     Types and the TeX log parser (unit tested)
src/renderer/   React UI: file tree, CodeMirror editor, pdf.js viewer, log panel
test/           node --test suites (npm test)
```

## Roadmap

Phase 2: SyncTeX (click PDF ↔ source), auto-compile while typing, `\ref`/`\cite` completion from
labels and `.bib` files, document outline, templates.
Phase 3: texlab diagnostics, spell check, word count, project-wide search, dark mode, git panel.
