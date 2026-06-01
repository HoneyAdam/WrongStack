import { builtinTools } from './builtin.js';

export const builtinToolsPack = {
  name: 'builtin-tools',
  description:
    'The complete set of built-in tools that ship with WrongStack. Covers filesystem (read/write/edit/replace/glob/grep/tree), execution (bash/exec/git/install), networking (fetch/search), code quality (lint/test/typecheck/format), planning (todo/plan/memory), and meta tools (tool-search/tool-help/batch-tool-use/codebase-*).',
  tools: builtinTools,
};
