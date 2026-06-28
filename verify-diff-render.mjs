// Standalone verification script — does NOT go through vitest/ink-testing-library.
// Imports DiffBlock directly and uses Ink 7's render() against a captured
// stdout, so we can see the real ANSI escapes Ink emits.

import { render } from 'ink';
import { createElement as e } from 'react';

// FORCE_COLOR — set this in the parent shell or hard-code here.
// Hard-code '1' so we always see the color path in this verification.
process.env['FORCE_COLOR'] = '1';

const { DiffBlock } = await import('./packages/tui/src/components/history/code-block.tsx');

const rows = [
  { kind: 'hunk', text: '@@ -1 +1 @@' },
  { kind: 'del', text: '-old line', oldLine: 1 },
  { kind: 'add', text: '+new line', newLine: 1 },
];

async function capture(useColor, forceColor) {
  const previous = process.env['FORCE_COLOR'];
  process.env['FORCE_COLOR'] = forceColor;
  return new Promise((resolve) => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    };
    const instance = render(e(DiffBlock, { rows, hidden: 0, useColor }), {
      exitOnCtrlC: false,
    });
    setTimeout(() => {
      instance.unmount();
      process.stdout.write = originalWrite;
      if (previous === undefined) delete process.env['FORCE_COLOR'];
      else process.env['FORCE_COLOR'] = previous;
      resolve(chunks.join(''));
    }, 200);
  });
}

const colored = await capture(true, '1');
const fallback = await capture(false, '0');

console.log('=== DiffBlock useColor=true (FORCE_COLOR=1) ===');
console.log('Captured length:', colored.length);
console.log('Contains background truecolor escape (\\x1b[48;2;...m):', /\x1b\[48;2;\d+;\d+;\d+m/.test(colored));
console.log('Contains bold escape (\\x1b[1m):', /\x1b\[1m/.test(colored));
console.log('First 500 chars (JSON-quoted):');
console.log(JSON.stringify(colored.slice(0, 500)));
console.log();

console.log('=== DiffBlock useColor=false (FORCE_COLOR=0) ===');
console.log('Captured length:', fallback.length);
console.log('Contains any bg escape (\\x1b[48;):', /\x1b\[48;/.test(fallback));
console.log('Contains bold escape (\\x1b[1m):', /\x1b\[1m/.test(fallback));
console.log('First 500 chars (JSON-quoted):');
console.log(JSON.stringify(fallback.slice(0, 500)));
console.log();

console.log('=== Summary ===');
console.log('useColor=true emitted background truecolor escape:', /\x1b\[48;2;\d+;\d+;\d+m/.test(colored));
console.log('useColor=false emitted NO background escape:       ', !/\x1b\[48;/.test(fallback));
console.log('useColor=false still emitted bold marker:           ', /\x1b\[1m/.test(fallback));
console.log('useColor=false still shows the +/- markers in text:  ', fallback.includes('-') && fallback.includes('+'));

process.exit(0);