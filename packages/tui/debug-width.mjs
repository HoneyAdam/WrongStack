// Quick debug script
const s = '名前';
console.log('String:', s);
console.log('length:', s.length);
for (const cp of s) {
  const code = cp.codePointAt(0);
  console.log(cp, code.toString(16), 'in CJK range?', code >= 0x3040 && code <= 0xa4cf);
}

const emoji = '✅';
console.log('\nEmoji:', emoji);
console.log('length:', emoji.length);
for (const cp of emoji) {
  const code = cp.codePointAt(0);
  console.log(cp, code.toString(16), 'in emoji range?', code >= 0x1f300 && code <= 0x1f5ff);
}
