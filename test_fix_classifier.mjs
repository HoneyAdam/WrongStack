// Quick test runner for fix-classifier without vitest
import { classifyError } from './packages/cli/src/slash-commands/fix-classifier.ts';

const cases = [
  // [input, expectedCategory]
  ['TS2345: Argument of type "string | null" is not assignable', 'ts'],
  ["TypeError: Cannot read property 'map' of undefined", 'runtime'],
  ['error[E0503]: expected something but found E0503 in src/lib.rs', 'runtime'],
  ['Segmentation fault (core dumped) at main.rs:42', 'runtime'],
  ["AttributeError: 'NoneType' object has no attribute 'encode'", 'runtime'],
  ['Security: hardcoded API key in config.ts', 'security'],
  ['SQL injection vulnerability in query builder', 'security'],
  ['TypeError: null is not a function', 'runtime'],
  ['Traceback (most recent call last):\n  File "test.py", line 42', 'runtime'],
  ['java.lang.NullPointerException', 'runtime'],
  ['gcc: error: undefined reference to main', 'compile'],
  ['memory leak: event listener not removed', 'perf'],
  ['ERRO1014: SQL injection vulnerability in query builder', 'security'],
  ['segmentation fault', 'runtime'],
];

let passed = 0;
let failed = 0;
for (const [input, expectedCat] of cases) {
  const r = classifyError(input);
  const ok = r.category === expectedCat;
  if (!ok) {
    console.log(`FAIL: "${input.slice(0, 60)}"`);
    console.log(`  expected=${expectedCat}, got=${r.category} (${r.subcategory}) conf=${r.confidence}`);
    failed++;
  } else {
    console.log(`PASS: "${input.slice(0, 50)}" → ${r.category}/${r.subcategory} [${r.confidence}]`);
    passed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);