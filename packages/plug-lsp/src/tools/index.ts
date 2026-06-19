import type { Tool } from '@wrongstack/core';
import { createCodebaseLspSearchTool } from './codebase-lsp-search.js';
import { createDefinitionTool } from './definition.js';
import { createDiagnosticsTool } from './diagnostics.js';
import { createRenameTool } from './rename.js';
import type { ToolDeps } from './shared.js';

// NOTE: The following LSP tools are intentionally excluded from the registered set:
//
//   lsp_references   — marginal over read/grep; returns positions the agent still has to read
//   lsp_hover        — usually confirms what reading the definition already showed
//   lsp_symbols      — a symbol tree is less useful than reading the file; codebase-lsp-search covers the search case
//   lsp_code_actions — high noise-to-signal in well-maintained codebases; mostly cosmetic
//
// The kept tools (lsp_diagnostics, lsp_definition, lsp_rename, codebase-lsp-search)
// are those where LSP provides genuinely unique data or capability the agent cannot
// replicate with basic tools (read, grep, edit) at comparable cost.

export function makeLSPTools(deps: ToolDeps): Tool[] {
  return [
    createDiagnosticsTool(deps),
    createDefinitionTool(deps),
    createCodebaseLspSearchTool(deps),
    createRenameTool(deps),
  ];
}
