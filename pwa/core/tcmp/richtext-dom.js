import { emptyDocument, validateDocument } from './protocol/messages/richtext.js';

function styleFromElement(el) {
  const tag = el.tagName?.toLowerCase();
  return {
    bold: tag === 'strong' || tag === 'b',
    italic: tag === 'em' || tag === 'i',
    underline: tag === 'u',
    strike: tag === 's' || tag === 'strike' || tag === 'del',
    code: tag === 'code'
  };
}

function mergeStyle(a, b) { return { bold: !!(a.bold || b.bold), italic: !!(a.italic || b.italic), underline: !!(a.underline || b.underline), strike: !!(a.strike || b.strike), code: !!(a.code || b.code) }; }

function collectSpans(node, inherited = {}) {
  const spans = [];
  for (const child of node.childNodes || []) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.nodeValue) spans.push({ text: child.nodeValue, style: inherited });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      spans.push(...collectSpans(child, mergeStyle(inherited, styleFromElement(child))));
    }
  }
  return spans;
}

export function documentFromEditable(editor) {
  const doc = { ...emptyDocument(), blocks: [] };
  const blocks = editor.querySelectorAll(':scope > div, :scope > p, :scope > li');
  if (!blocks.length) {
    const spans = collectSpans(editor);
    doc.blocks.push({ type: 'paragraph', spans: spans.length ? spans : [{ text: editor.textContent || '', style: {} }] });
  } else {
    for (const block of blocks) {
      const type = block.tagName.toLowerCase() === 'li' ? 'list-item' : 'paragraph';
      doc.blocks.push({ type, spans: collectSpans(block) });
    }
  }
  return validateDocument(doc);
}

function esc(s) { return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
export function renderRichText(doc, target) {
  validateDocument(doc);
  target.innerHTML = '';
  for (const block of doc.blocks) {
    const p = document.createElement(block.type === 'list-item' ? 'li' : 'p');
    for (const span of block.spans || []) {
      let el = document.createElement(span.style?.code ? 'code' : 'span');
      el.textContent = span.text || '';
      if (span.style?.bold) el.style.fontWeight = '700';
      if (span.style?.italic) el.style.fontStyle = 'italic';
      if (span.style?.underline) el.style.textDecoration = 'underline';
      if (span.style?.strike) el.style.textDecoration = 'line-through';
      p.appendChild(el);
    }
    target.appendChild(p);
  }
}
