import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import type { BinaryStoredFileKind } from './storedFiles.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 把纯文本拆成可读段落 HTML（旧版 .doc） */
function textToReadableHtml(raw: string): string {
  const normalized = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!normalized) {
    return '<p class="word-empty">（文档无正文）</p>';
  }
  const blocks = normalized.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block
        .split('\n')
        .map((line) => escapeHtml(line.trimEnd()))
        .join('<br/>');
      return `<p>${lines || '&nbsp;'}</p>`;
    })
    .join('\n');
}

export type WordPreviewResult = {
  kind: BinaryStoredFileKind;
  /** rich：mammoth HTML；text：旧版 .doc 提取文本 */
  mode: 'rich' | 'text';
  html: string;
  messages?: string[];
};

/**
 * 把 Word 二进制转为可在线阅读的 HTML。
 * - docx：mammoth 保留标题/列表等结构
 * - doc：word-extractor 抽正文，排成段落
 */
export async function renderWordBufferToHtml(
  kind: 'doc' | 'docx',
  buffer: Buffer,
): Promise<WordPreviewResult> {
  if (kind === 'docx') {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
        ],
      },
    );
    const html = String(result.value || '').trim() || '<p class="word-empty">（文档无正文）</p>';
    return {
      kind: 'docx',
      mode: 'rich',
      html,
      messages: (result.messages || []).map((m) => String(m.message || m)),
    };
  }

  const extractor = new WordExtractor();
  const document = await extractor.extract(buffer);
  const body = String(document.getBody?.() ?? '');
  const headers = String(document.getHeaders?.() ?? '').trim();
  const footers = String(document.getFooters?.() ?? '').trim();
  const parts: string[] = [];
  if (headers) {
    parts.push(`<header class="word-header">${textToReadableHtml(headers)}</header>`);
  }
  parts.push(`<article class="word-body">${textToReadableHtml(body)}</article>`);
  if (footers) {
    parts.push(`<footer class="word-footer">${textToReadableHtml(footers)}</footer>`);
  }
  return {
    kind: 'doc',
    mode: 'text',
    html: parts.join('\n'),
  };
}
