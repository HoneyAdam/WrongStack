export { readTool } from './read.js';
export { writeTool } from './write.js';
export { editTool } from './edit.js';
export { replaceTool } from './replace.js';
export { globTool } from './glob.js';
export { grepTool } from './grep.js';
export { bashTool } from './bash.js';
export { execTool } from './exec.js';
export { fetchTool } from './fetch.js';
export { searchTool } from './search.js';
export { todoTool } from './todo.js';
export { gitTool } from './git.js';
export { patchTool } from './patch.js';
export { jsonTool } from './json.js';
export { diffTool } from './diff.js';
export { treeTool } from './tree.js';
export { lintTool } from './lint.js';
export { formatTool } from './format.js';
export { typecheckTool } from './typecheck.js';
export { testTool } from './test.js';
export { installTool } from './install.js';
export { auditTool } from './audit.js';
export { outdatedTool } from './outdated.js';
export { logsTool } from './logs.js';
export { documentTool } from './document.js';
export { scaffoldTool } from './scaffold.js';
export { toolSearchTool } from './tool-search.js';
export { toolUseTool } from './tool-use.js';
export { batchToolUseTool } from './batch-tool-use.js';
export { toolHelpTool } from './tool-help.js';
export { rememberTool, forgetTool } from './memory.js';
export { createModeTool } from './mode.js';

import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { replaceTool } from './replace.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { bashTool } from './bash.js';
import { execTool } from './exec.js';
import { fetchTool } from './fetch.js';
import { searchTool } from './search.js';
import { todoTool } from './todo.js';
import { gitTool } from './git.js';
import { patchTool } from './patch.js';
import { jsonTool } from './json.js';
import { diffTool } from './diff.js';
import { treeTool } from './tree.js';
import { lintTool } from './lint.js';
import { formatTool } from './format.js';
import { typecheckTool } from './typecheck.js';
import { testTool } from './test.js';
import { installTool } from './install.js';
import { auditTool } from './audit.js';
import { outdatedTool } from './outdated.js';
import { logsTool } from './logs.js';
import { documentTool } from './document.js';
import { scaffoldTool } from './scaffold.js';
import { toolSearchTool } from './tool-search.js';
import { toolUseTool } from './tool-use.js';
import { batchToolUseTool } from './batch-tool-use.js';
import { toolHelpTool } from './tool-help.js';
import type { Tool } from '@wrongstack/core';

export const builtinTools: Tool[] = [
  readTool,
  writeTool,
  editTool,
  replaceTool,
  globTool,
  grepTool,
  bashTool,
  execTool,
  fetchTool,
  searchTool,
  todoTool,
  gitTool,
  patchTool,
  jsonTool,
  diffTool,
  treeTool,
  lintTool,
  formatTool,
  typecheckTool,
  testTool,
  installTool,
  auditTool,
  outdatedTool,
  logsTool,
  documentTool,
  scaffoldTool,
  toolSearchTool,
  toolUseTool,
  batchToolUseTool,
  toolHelpTool,
];
