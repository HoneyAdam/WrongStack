import { builtinTools } from './builtin.js';

export const builtinToolsPack = {
  name: 'builtin-tools',
  description:
    'The complete set of built-in tools that ship with WrongStack. Covers filesystem, execution, first-party browser automation, read-only E2E planning, networking, code quality, planning, and meta tools.',
  tools: builtinTools,
};
