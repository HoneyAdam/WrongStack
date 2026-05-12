export type NewlineStyle = 'lf' | 'crlf' | 'cr';

export function detectNewlineStyle(text: string): NewlineStyle {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (c === 0x0a) {
      lf++;
    }
  }
  if (crlf > lf && crlf > cr) return 'crlf';
  if (cr > lf && cr > crlf) return 'cr';
  return 'lf';
}

export function toStyle(text: string, style: NewlineStyle): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (style === 'lf') return normalized;
  if (style === 'crlf') return normalized.replace(/\n/g, '\r\n');
  return normalized.replace(/\n/g, '\r');
}

export function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
