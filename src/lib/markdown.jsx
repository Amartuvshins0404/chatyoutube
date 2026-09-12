import React from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { parseStamp, seek } from './time.js';

marked.setOptions({ gfm: true, breaks: true });

const TS = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

export function Md({ text }) {
  const raw = DOMPurify.sanitize(marked.parse(text || ''), { ADD_ATTR: ['data-t'] });
  const html = raw.replace(TS, (_, stamp) => {
    const sec = parseStamp(stamp);
    if (sec == null) return `[${stamp}]`;
    return `<button type="button" class="ts" data-t="${sec}">${stamp}</button>`;
  });

  const onClick = (e) => {
    const btn = e.target.closest?.('button.ts');
    if (!btn) return;
    seek(Number(btn.dataset.t));
  };

  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
