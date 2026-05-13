/**
 * Minimal glob matcher for trust patterns.
 * Supports: *, **, ?, character classes [abc], [a-z], negation [!...] or [^...].
 *
 * Both `[!...]` (shell glob convention) and `[^...]` (regex convention) are
 * accepted because users coming from either world will reach for what they
 * know; rejecting one silently fails open in a security-sensitive context.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|\\/]/g, '\\$&');
}

export function compileGlob(pattern: string): RegExp {
  let i = 0;
  let re = '^';
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any number of chars including /
        re += '.*';
        i += 2;
        // Skip trailing slash so '**/x' matches 'x'
        if (pattern[i] === '/') i++;
      } else {
        // single * matches any chars except /
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '[') {
      let cls = '[';
      i++;
      if (pattern[i] === '!' || pattern[i] === '^') {
        cls += '^';
        i++;
      }
      while (i < pattern.length && pattern[i] !== ']') {
        const ch = pattern[i] ?? '';
        // Inside a regex class, only `]`, `\`, and `^`/`-` at boundaries need
        // escaping. We've already consumed the leading `^`; the rest are
        // literal. Escape `\` defensively and pass the rest through verbatim
        // so ranges like `a-z` continue to work.
        if (ch === '\\') {
          cls += '\\\\';
        } else if (ch === ']' || ch === '^') {
          cls += `\\${ch}`;
        } else {
          cls += ch;
        }
        i++;
      }
      cls += ']';
      re += cls;
      i++; // skip closing ]
    } else {
      re += escapeRegex(c ?? '');
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

export function matchGlob(pattern: string, input: string): boolean {
  return compileGlob(pattern).test(input);
}

export function matchAny(patterns: string[], input: string): boolean {
  return patterns.some((p) => matchGlob(p, input));
}
