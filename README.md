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
- **Smart editing with [texlab](https://github.com/latex-lsp/texlab)** (included in the app). Completion of commands,
  environments, `\ref` labels (with their numbers), `\cite` keys and file names; hover previews of
  citations and labels; go to definition (F12), find references (⇧F12), rename (F2), format
  (⇧⌥F); optional chktex style hints.
- **Spell checking** with macOS dictionaries, LaTeX-aware (skips commands, math, labels), with the
  language detected per document (e.g. English or German). Right-click for suggestions.
- **File outline, project-wide search and replace, word count** (texcount).
- **Source control.** Initialise a git repository, see changes and diffs, commit, push and pull.
- **Light and dark themes**, following macOS by default.

## Install (for friends)

Underleaf runs on any Mac with macOS 11 or newer, Intel or Apple chip.

1. **Install MacTeX**, the LaTeX system Underleaf uses to build PDFs. It's free and about 5 GB:
   download `MacTeX.pkg` from [tug.org/mactex](https://tug.org/mactex/) and install it.
2. **Download Underleaf**: open the [latest release](../../releases/latest) and download
   `Underleaf-<version>.dmg`.
3. **Install it**: open the DMG and drag **Underleaf** into **Applications**.
4. **Open it the first time.** Underleaf is free and not registered with Apple, so macOS blocks
   it at first with a message like *"Apple could not verify Underleaf"*. Click **Done**, then:
   - open **System Settings → Privacy & Security**, scroll down to *"Underleaf was blocked…"*,
     click **Open Anyway** and confirm with your password.

   On macOS 14 or older you can instead right-click the app in Applications and choose **Open**.
   After that it opens normally. (Alternatively, run
   `xattr -dr com.apple.quarantine /Applications/Underleaf.app` in Terminal once.)

That's it: click **New project** or open any folder with `.tex` files. Everything else
(texlab for smart completion, the spell checker) is built into the app.

## Build from source

Requirements: macOS 11+, [MacTeX](https://tug.org/mactex/), Node.js 20+ and Xcode Command Line
Tools (`xcode-select --install`, for `swiftc`).

```bash
npm install
npm run package          # quick build for this Mac: dist/mac*/Underleaf.app
npm run dist             # universal DMG for Intel + Apple Silicon: dist/Underleaf-<version>.dmg
```

`npm run native` (part of every build) compiles the spell-check helper and downloads texlab
5.26.0 for both chip types, verifying it against the release's published SHA-256 checksums.

For development with hot reload: `npm run dev`. To open a folder directly on launch, set
`UNDERLEAF_OPEN=/path/to/project`. Tests: `npm test`; type checks: `npm run typecheck`.

## Making a release

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.
3. The **Release** workflow builds the universal DMG on GitHub's Macs and publishes it as a
   GitHub Release with install instructions. You can also run it by hand from the Actions tab to
   get the DMG as a download without publishing.

The app is ad-hoc signed, which is free and lets it run on Apple chips, but macOS asks users to
approve it once (step 4 above). To remove that step, join the Apple Developer Program, sign with
a Developer ID and notarize: set `mac.identity` in `electron-builder.yml` and provide the
certificate to the workflow.

## How it works

- Underleaf adds a hidden `.underleaf/` folder to each project holding `settings.json` (main
  document, compiler) and the build output, and git-ignores it automatically.
- Compiling runs `latexmk -f -interaction=nonstopmode -file-line-error -synctex=1` with the output
  in `.underleaf/build`, so your project folder stays clean.
- Edits autosave after a second of inactivity. Files changed by other programs reload automatically
  (unless you have unsaved edits in that file).
- Spell checking runs through `underleaf-spell`, a small Swift helper (`native/spell.swift`) built
  as a universal binary by `npm run native` and shipped inside the app, as is texlab. A texlab
  installed with Homebrew is used only when the bundled one is missing.

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
scripts/        Build helpers: compile the spell helper, fetch texlab
test/           node --test suites (npm test)
```

## License

Underleaf is MIT licensed (see [LICENSE](LICENSE)). It bundles texlab, which is GPL-3.0 licensed;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
