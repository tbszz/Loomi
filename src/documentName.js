// Repair UTF-8 filenames decoded as latin1 by multipart clients, without changing
// valid names or persisting a lossy replacement.
export function readableDocumentName(value = '') {
  const name = String(value);
  if (!/[\u0080-\u00ff]/.test(name) || [...name].some(c => c.charCodeAt(0) > 255)) return name;
  try {
    return new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(name, c=>c.charCodeAt(0)));
  } catch { return name; }
}
