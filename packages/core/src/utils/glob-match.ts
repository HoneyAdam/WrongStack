/**
 * Minimal glob matcher for trust patterns.
 * Supports: *, **, ?, character classes [abc], [a-z], negation [!...].
 */

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|\\]/g, '\\$&');
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
      if (pattern[i] === '!') {
        cls += '^';
        i++;
      }
      while (i < pattern.length && pattern[i] !== ']') {
        const ch = pattern[i] ?? '';
        cls += escapeRegex(ch);
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
