import { marked } from 'marked';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * In-memory LRU cache for rendered Markdown and KaTeX math formulas.
 * Prevents re-parsing historical messages on every reactive trigger (e.g. typing, streaming).
 */
const MAX_CACHE_SIZE = 1000;
const markdownCache = new Map<string, string>();

/**
 * Render Markdown content to HTML with full LaTeX math formula support (KaTeX).
 * Handles inline math ($...$, \(...\)) and block display math ($$...$$, \[...\]),
 * while protecting code blocks and preventing Markdown syntax from mangling LaTeX.
 */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  const raw = typeof content === 'string' ? content : String(content);

  const cached = markdownCache.get(raw);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const mathTokens: string[] = [];

    // Step 1: Protect code blocks & inline code from math parsing
    const codeTokens: string[] = [];
    let text = raw.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
      const placeholder = `@@CODE_TOKEN_${codeTokens.length}@@`;
      codeTokens.push(match);
      return placeholder;
    });

    // Step 2: Extract block/display math ($$...$$ or \[...\])
    text = text.replace(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/g, (match) => {
      let formula = match;
      if (match.startsWith('$$') && match.endsWith('$$')) {
        formula = match.slice(2, -2).trim();
      } else if (match.startsWith('\\[') && match.endsWith('\\]')) {
        formula = match.slice(2, -2).trim();
      }

      const placeholder = `\n\n@@BLOCK_MATH_${mathTokens.length}@@\n\n`;
      try {
        const rendered = katex.renderToString(formula, {
          displayMode: true,
          throwOnError: false,
        });
        mathTokens.push(`<div class="katex-display-wrapper">${rendered}</div>`);
      } catch (err) {
        mathTokens.push(`<pre class="math-error">${formula}</pre>`);
      }
      return placeholder;
    });

    // Step 3: Extract inline math ($...$ or \(...\))
    // Matches $...$ that is not empty, not just digits/currency, and surrounded properly
    text = text.replace(/(\\\([\s\S]+?\\\)|(?<![\$\w])\$([^\$\n]+?)\$(?![\$\w]))/g, (match, _p1, p2) => {
      let formula = p2;
      if (match.startsWith('\\(') && match.endsWith('\\)')) {
        formula = match.slice(2, -2).trim();
      } else if (!formula) {
        formula = match.slice(1, -1).trim();
      }

      // Ignore currency expressions (e.g. $10, $50.00) or empty
      if (!formula || /^\d/.test(formula)) {
        return match;
      }

      const placeholder = `@@INLINE_MATH_${mathTokens.length}@@`;
      try {
        const rendered = katex.renderToString(formula, {
          displayMode: false,
          throwOnError: false,
        });
        mathTokens.push(rendered);
      } catch (err) {
        mathTokens.push(`<code>${formula}</code>`);
      }
      return placeholder;
    });

    // Step 4: Restore code blocks
    text = text.replace(/@@CODE_TOKEN_(\d+)@@/g, (_, i) => codeTokens[Number(i)]);

    // Step 5: Parse Markdown with marked
    let html = marked.parse(text, { async: false }) as string;

    // Step 6: Restore rendered math into HTML (cleaning any enclosing <p> tags for block math)
    html = html.replace(/<p>\s*@@BLOCK_MATH_(\d+)@@\s*<\/p>/g, (_, i) => mathTokens[Number(i)]);
    html = html.replace(/@@(?:BLOCK|INLINE)_MATH_(\d+)@@/g, (_, i) => mathTokens[Number(i)]);

    if (markdownCache.size >= MAX_CACHE_SIZE) {
      const firstKey = markdownCache.keys().next().value;
      if (firstKey) markdownCache.delete(firstKey);
    }
    markdownCache.set(raw, html);

    return html;
  } catch (err) {
    console.warn('Markdown parse failed, fallback to raw text:', err);
    return raw;
  }
}
