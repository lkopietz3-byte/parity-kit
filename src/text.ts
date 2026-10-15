/**
 * A name or value shortened for a message, so detail text never grows with
 * the input (a 5 MB id shared by many records would otherwise be copied into
 * every message). Cuts on a code point and says how long the original was.
 */
export function clip(text: string, max = 40): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}... (${text.length} units)`;
}
