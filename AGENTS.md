# AGENTS.md — Contributor & AI Agent Guide for Advanced PDF Export

This document provides architectural guidance, technical conventions, and operational workflows for AI coding agents and human contributors working on the **Advanced PDF Export** Obsidian plugin.

---

## 1. Project Overview

**Advanced PDF Export** (`advanced-pdf-export`) is a desktop-only Obsidian plugin that renders Markdown notes into pixel-perfect, publication-ready PDF documents. 

Key capabilities:
- **Full-Screen Split Modal**: Side-by-side Markdown editor (left) and paginated live preview (right) with continuous re-rendering, zoom controls, and theme selection.
- **Custom Pagination Engine**: Virtual measuring sandbox that paginates rendered HTML into discrete page buckets, cleanly splitting paragraphs, lists, tables, and code blocks.
- **Style Presets & Typography**: Built-in visual themes (Default, Minimal, Academic, Colorful, Modern, Newspaper, Dark), typography scaling, and Prism-based code syntax highlighting.
- **Header, Footer & Frame Decorators**: Customizable header/footer text with dynamic placeholders (`{{current}}`, `{{total}}`, `{{title}}`), image banners, and configurable outer page borders.
- **PDF Bookmarks/Outline**: Automatically generates and injects a PDF bookmark tree into the exported binary using `pdf-lib`.
- **Electron Print Pipeline**: Leverages Electron's offscreen `BrowserWindow` and `printToPDF` / `print` API for high-fidelity output.

> [!NOTE]
> This plugin is strictly **Desktop Only** (`"isDesktopOnly": true` in `manifest.json`) because it relies on Electron's background print pipeline and native file-save dialogs via `@electron/remote`.

---

## 2. Technology Stack

- **Runtime Environment**: Obsidian Desktop app (Chromium + Node.js via Electron).
- **Language**: TypeScript (`~5.8`), targeting `es2022` with CommonJS module output.
- **Bundler**: `esbuild` (`~0.25`) driven by [`esbuild.config.mjs`](file:///Users/giacomo/git/advanced-pdf-export/esbuild.config.mjs).
- **Core Dependencies**:
  - `obsidian`: Official Obsidian API definitions (`Plugin`, `Modal`, `MarkdownRenderer`, `PluginSettingTab`, etc.).
  - `pdf-lib`: Binary PDF manipulation library used for injecting PDF outline/bookmarks.
  - `@electron/remote`: Electron inter-process communication bridge for opening hidden rendering windows and native OS file dialogs.
- **Key Artifacts**:
  - [`manifest.json`](file:///Users/giacomo/git/advanced-pdf-export/manifest.json): Plugin metadata required by Obsidian.
  - `main.js`: The bundled output produced by `esbuild` (entry point loaded by Obsidian).
  - [`styles.css`](file:///Users/giacomo/git/advanced-pdf-export/styles.css): Static styles for modal dialogs, toolbar controls, buttons, and loading overlays.

---

## 3. Directory & Component Architecture

All source code resides in `src/`. Responsibilities are strictly segregated across the following modules:

```
src/
├── main.ts            # Plugin entry point & lifecycle management
├── settings.ts        # Data schemas, presets, and configuration defaults (Pure data/types)
├── settings-tab.ts    # Obsidian settings panel UI
├── markdown.ts        # Markdown processing, sanitization & Obsidian renderer bridge
├── paginator.ts       # Pixel-measuring pagination engine & PDF outline injector
├── css-builder.ts     # Dynamic CSS generation, code themes, MathJax stylesheet inlining
└── export-modal.ts    # Split-screen modal UI, preview renderer & Electron PDF export pipeline
```

### Module Breakdown

#### [`src/main.ts`](file:///Users/giacomo/git/advanced-pdf-export/src/main.ts)
- Extends `Plugin` from Obsidian.
- Registers the `"open-panel"` command and the context menu item on Markdown files.
- Mounts `PDFExportSettingTab`.
- Manages settings persistence (`loadSettings`, `saveSettings`, `validateSettings`).
- Pre-warms MathJax in the background on startup (`warmUpMathJax`) to eliminate cold-start lag.

#### [`src/settings.ts`](file:///Users/giacomo/git/advanced-pdf-export/src/settings.ts)
- **Strictly pure data and TypeScript interfaces**. Contains no DOM manipulation or Obsidian API imports.
- Defines `DocStyle`, `PDFExportSettings`, standard `PAGE_SIZES` (A4, A3, Letter, Legal, A5), and default configurations (`DEFAULT_SETTINGS`, `PRESETS`).
- When introducing a new setting or preset, update this file first.

#### [`src/settings-tab.ts`](file:///Users/giacomo/git/advanced-pdf-export/src/settings-tab.ts)
- Extends `PluginSettingTab`.
- Renders the full settings interface inside Obsidian's preferences window, grouped by logical categories (Presets, Page, Margins & Frame, Typography, Background, Header & Footer, Content).

#### [`src/markdown.ts`](file:///Users/giacomo/git/advanced-pdf-export/src/markdown.ts)
- Markdown pre-processing: normalizes line endings (`\r\n` → `\n`), strips frontmatter, splits on manual page breaks (`///`), and detects RTL script orientation.
- Renders Markdown through Obsidian's `MarkdownRenderer.render()` using a dedicated component context.
- Post-processes rendered HTML: strips interactive buttons (copy-code buttons, fold controls), expands callouts, normalizes heading IDs for internal cross-reference anchors, and strips unwanted Obsidian theme style injections.

#### [`src/paginator.ts`](file:///Users/giacomo/git/advanced-pdf-export/src/paginator.ts)
- **Pagination Engine (`paginateEl`)**:
  - Uses an offscreen Shadow DOM sandbox to measure rendered elements at the exact target page width.
  - Distributes block elements across pages, splitting inline elements, lists, tables, and pre/code blocks when necessary.
- **Layout Assembly (`buildPageLayouts`)**:
  - Computes per-page header and footer elements, evaluating dynamic placeholders (`{{current}}`, `{{total}}`, `{{title}}`).
- **PDF Bookmark Injection (`injectPDFOutline`)**:
  - Uses `pdf-lib` to read the exported PDF buffer, build a dictionary-based outline tree matching document headings, and save the modified PDF bytes.

#### [`src/css-builder.ts`](file:///Users/giacomo/git/advanced-pdf-export/src/css-builder.ts)
- Converts settings into scoped CSS strings for both the Shadow DOM preview and the Electron print target.
- Generates typography rules, table styling, blockquotes, callout frames, and page background rules.
- Manages Prism syntax highlighting token maps (`CODE_THEMES`).
- Handles MathJax stylesheets: extracts fonts, computes inlined base64 data URIs so equations render properly in Electron's offscreen window (`getMathJaxCSSInlined`).

#### [`src/export-modal.ts`](file:///Users/giacomo/git/advanced-pdf-export/src/export-modal.ts)
- Implements `PDFExportModal` (subclass of Obsidian's `Modal`).
- Builds the split-view UI (left: Markdown textarea, right: Shadow DOM paginated preview).
- Caches rendered layouts in `LayoutCache` so zoom or scaling adjustments do not trigger re-pagination.
- Orchestrates PDF export:
  1. Compiles full standalone HTML (`buildExportDocument`).
  2. Spawns an offscreen Electron `BrowserWindow` via `@electron/remote`.
  3. Waits for `document.fonts.ready` and MathJax stylesheets.
  4. Calls `webContents.printToPDF()`.
  5. Injects PDF outline bookmarks via `injectPDFOutline`.
  6. Writes file to disk via native save dialog or dispatches to OS print spooler.

---

## 4. Development & Build Workflow

### Prerequisites
- **Node.js**: v18+ (tested with v26).
- **npm**: v9+.

### Common Commands
```bash
# Install dependencies
npm install

# Build for production (runs TypeScript type-check then esbuild with minification)
npm run build

# Start development watch mode (recompiles main.js automatically on file changes)
npm run dev
```

### Testing in Obsidian (Live Vault Workflow)
To test local changes live in Obsidian:
1. Locate your Obsidian Vault plugins directory:
   `<VaultPath>/.obsidian/plugins/advanced-pdf-export`
2. Create a symbolic link pointing to this repository root:
   ```bash
   ln -s "/Users/giacomo/git/advanced-pdf-export" "<VaultPath>/.obsidian/plugins/advanced-pdf-export"
   ```
3. Run `npm run dev` in your terminal.
4. In Obsidian:
   - Enable "Advanced PDF Export" under **Settings → Community Plugins**.
   - Use the **Hot Reload** community plugin or reload the Obsidian window (`Cmd+R` / `Ctrl+R`) to apply updates.

---

## 5. Coding Standards & Architectural Guardrails

When proposing or implementing changes, adhere strictly to these principles:

1. **Parity Between Preview and Export**:
   - The preview (in `export-modal.ts` via Shadow DOM) and the exported PDF (generated via Electron's `printToPDF`) **must always remain visually identical**.
   - Do not add styles or layout logic to one path without ensuring the other receives the exact equivalent. Always leverage `LayoutCache` and shared helpers in `css-builder.ts`.

2. **Decoupled Settings**:
   - `settings.ts` must never import from `obsidian`, touch DOM APIs, or access the filesystem. It should remain a pure TypeScript contract.
   - Any new setting must include a sensible default in `DEFAULT_SETTINGS` and boundary validation in `main.ts` (`validateSettings()`).

3. **Defensive Pagination Loop**:
   - In `paginator.ts`, any split operation (`splitElement`, `splitPreElement`, `splitTableElement`, `splitListElement`) must strictly guarantee progress.
   - If an element does not fit and cannot be split, it must be pushed to a fresh page; if it still exceeds the full page height, it must be forced onto its own page rather than looping indefinitely.

4. **Resource URL Resolution**:
   - Local vault images and assets must be resolved via `app.vault.getResourcePath(...)` so they produce valid `app://` URLs that Electron's offscreen window can load. Always use `resolveImageUrl` in `css-builder.ts`.

5. **Asynchronous Engine Stabilization**:
   - MathJax and Mermaid rendering are asynchronous. Never capture the DOM or trigger Electron printing before `waitForMathJaxStylesheetStable()` and Obsidian's math/diagram render passes have settled.

6. **Code Simplicity & Backward Compatibility**:
   - Keep TypeScript types clean and explicit.
   - Maintain compatibility with saved settings: when adding new schema properties, ensure migrations or fallback defaults exist for notes with existing stored configurations.
