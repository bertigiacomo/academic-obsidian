// ─────────────────────────────────────────────────────────────────────────────
// Academic fenced-block processors.
//
// Registers MarkdownCodeBlockProcessors for academic document constructs:
// algorithm blocks (pseudocode with line numbering, keyword highlighting,
// monospace typography, and formal algorithm2e-style framing) and theorem-family
// blocks (theorem, lemma, proof, definition) with recursive Markdown-in-Markdown.
// ─────────────────────────────────────────────────────────────────────────────

import { MarkdownRenderer, Component, MarkdownPostProcessorContext, renderMath, finishRenderMath } from "obsidian";
import type MarkdownPDFPlugin from "./main";

function escapeHtml(str: string): string {
  return str.replace(/[&<>'"]/g, (tag) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[tag] || tag));
}

const ALGO_KEYWORDS = [
  "if", "else", "then", "while", "for", "do", "repeat", "until",
  "return", "end", "begin", "function", "procedure", "input", "output",
  "and", "or", "not", "to", "downto", "each", "in", "break", "continue",
  "true", "false", "nil", "null", "class", "new", "throw", "try", "catch",
  "switch", "case", "default", "yield", "async", "await",
];
const KW_REGEX = new RegExp(`\\b(${ALGO_KEYWORDS.join("|")})\\b`, "g");

/** Renders mixed text containing plain text, keywords, and LaTeX inline math ($...$) */
function renderInlineWithMath(container: HTMLElement, text: string, isCode: boolean): void {
  // Split by $...$ inline math delimiters
  const parts = text.split(/(\$[^\$]+\$)/g);
  for (const part of parts) {
    if (part.startsWith("$") && part.endsWith("$") && part.length >= 2) {
      const mathSrc = part.slice(1, -1);
      try {
        const mathEl = renderMath(mathSrc, false);
        container.appendChild(mathEl);
      } catch {
        container.appendText(part);
      }
    } else if (part) {
      if (isCode) {
        // Highlight keywords in code text
        const span = container.createSpan();
        let html = escapeHtml(part);
        html = html.replace(KW_REGEX, '<strong class="mpdf-algo-keyword">$1</strong>');
        span.innerHTML = html;
      } else {
        container.appendText(part);
      }
    }
  }
}

export function registerBlockProcessors(plugin: MarkdownPDFPlugin) {
  // 1. Algorithm Block Processor
  plugin.registerMarkdownCodeBlockProcessor("algorithm", async (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
    const lines = source.split("\n");
    const container = el.createDiv({ cls: "mpdf-algorithm" });

    if (lines.length === 0) return;

    // Header line: Algorithm: Title(params)
    const titleLine = lines[0].trim();
    const headerEl = container.createDiv({ cls: "mpdf-algo-header" });
    const labelSpan = headerEl.createSpan({ cls: "mpdf-algo-title-label" });
    labelSpan.innerHTML = "<strong>Algorithm:</strong>&nbsp;";
    renderInlineWithMath(headerEl, titleLine, false);

    container.createDiv({ cls: "mpdf-algo-separator" });

    let isBodyStarted = false;
    let bodyEl: HTMLElement | null = null;
    let lineNum = 1;

    for (let i = 1; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();

      // Empty lines in body
      if (!trimmed) {
        if (bodyEl) {
          const lineEl = bodyEl.createDiv({ cls: "mpdf-algo-line" });
          lineEl.createSpan({ cls: "mpdf-algo-line-num", text: `${lineNum}:` });
          lineEl.createSpan({ cls: "mpdf-algo-line-content", text: "" });
          lineNum++;
        }
        continue;
      }

      // Input / Output header directives
      const lower = trimmed.toLowerCase();
      if (!isBodyStarted && (lower.startsWith("input:") || lower.startsWith("output:"))) {
        const colonIdx = trimmed.indexOf(":");
        const label = trimmed.substring(0, colonIdx + 1);
        const rest = trimmed.substring(colonIdx + 1).trim();

        const ioEl = container.createDiv({ cls: "mpdf-algo-io" });
        const ioLabel = ioEl.createSpan({ cls: "mpdf-algo-io-label" });
        ioLabel.innerHTML = `<strong>${escapeHtml(label)}</strong>&nbsp;`;
        renderInlineWithMath(ioEl, rest, false);
        continue;
      }

      // First real code line starts body
      if (!isBodyStarted) {
        isBodyStarted = true;
        bodyEl = container.createDiv({ cls: "mpdf-algo-body" });
      }

      if (bodyEl) {
        const lineEl = bodyEl.createDiv({ cls: "mpdf-algo-line" });
        lineEl.createSpan({ cls: "mpdf-algo-line-num", text: `${lineNum}:` });

        // Measure leading whitespace indentation
        const indentMatch = rawLine.match(/^(\s+)/);
        const indentSpaces = indentMatch ? indentMatch[1].length : 0;
        let lineText = rawLine.substring(indentSpaces);

        const contentEl = lineEl.createSpan({ cls: "mpdf-algo-line-content" });

        // Indent using em spacing
        if (indentSpaces > 0) {
          contentEl.style.paddingLeft = `${indentSpaces * 0.55}em`;
        }

        // Check for comments
        const commentIdx = lineText.indexOf("//");
        if (commentIdx === 0) {
          // Whole line is comment
          const cSpan = contentEl.createSpan({ cls: "mpdf-algo-comment", text: lineText });
        } else if (commentIdx > 0) {
          // Code followed by comment
          const codePart = lineText.substring(0, commentIdx);
          const commentPart = lineText.substring(commentIdx);
          renderInlineWithMath(contentEl, codePart, true);
          contentEl.createSpan({ cls: "mpdf-algo-comment", text: commentPart });
        } else {
          // Pure code
          renderInlineWithMath(contentEl, lineText, true);
        }

        lineNum++;
      }
    }

    try {
      await finishRenderMath();
    } catch {
      /* non-fatal */
    }
  });

  // 2. Theorem-family Block Processors
  const theoremTypes = ["theorem", "lemma", "proof", "definition"] as const;

  for (const type of theoremTypes) {
    plugin.registerMarkdownCodeBlockProcessor(type, async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const lines = source.split("\n");
      let title = "";
      let content = source;

      if (lines.length > 0) {
        const firstLine = lines[0].trim();
        const nonTitlePatterns = /^(\$|\*|\-|\>|\d+\.)/;
        if (firstLine && !nonTitlePatterns.test(firstLine)) {
          title = firstLine;
          content = lines.slice(1).join("\n");
        }
      }

      const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      const comp = new Component();
      comp.load();

      if (type === "proof") {
        const box = el.createDiv({ cls: "mpdf-proof-box" });
        const header = box.createDiv({ cls: "mpdf-proof-header" });
        header.innerHTML = `<em>Proof.</em>${title ? `<span class="mpdf-theorem-title"> (${escapeHtml(title)})</span>` : ""}`;

        const contentEl = box.createDiv({ cls: "mpdf-proof-content" });
        await MarkdownRenderer.render(plugin.app, content, contentEl, ctx.sourcePath, comp);
      } else {
        const box = el.createDiv({ cls: `mpdf-theorem-box mpdf-theorem-type-${type}` });
        const header = box.createDiv({ cls: "mpdf-theorem-header" });
        header.innerHTML = `<strong>${typeLabel}</strong>${title ? `<span class="mpdf-theorem-title"> (${escapeHtml(title)})</span>` : ""}`;

        const contentEl = box.createDiv({ cls: "mpdf-theorem-content" });
        await MarkdownRenderer.render(plugin.app, content, contentEl, ctx.sourcePath, comp);
      }
    });
  }
}

