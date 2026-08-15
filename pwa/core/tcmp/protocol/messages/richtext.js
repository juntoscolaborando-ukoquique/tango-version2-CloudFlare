// Formato estable y deliberadamente pequeño. No se intenta serializar HTML.
export const emptyDocument = () => ({v:1,type:'richtext',blocks:[]});
export function paragraph(...spans) { return {type:'paragraph',spans:spans.map(normalizeSpan)}; }
export function textSpan(text, style={}) { return normalizeSpan({text,style}); }
function normalizeSpan(s) {
  return {text:String(s.text ?? ''),style:{
    bold:!!s.style?.bold, italic:!!s.style?.italic, underline:!!s.style?.underline,
    strike:!!s.style?.strike, code:!!s.style?.code
  }};
}
export function validateDocument(doc) {
  if(!doc || doc.v!==1 || doc.type!=='richtext' || !Array.isArray(doc.blocks)) throw new Error('RichTextDocument inválido');
  return doc;
}
