/**
 * TypeScript/JavaScript symbol extraction using the TypeScript Compiler API.
 *
 * We traverse the AST and collect:
 * - classes, interfaces, enums, type aliases  → class|interface|enum|type
 * - functions and methods                       → function|method
 * - const/let/var declarations                 → const|let|var
 * - property/accessor declarations            → property
 *
 * The `id` field on each Symbol is always 0 — the caller is responsible for
 * assigning unique ids during insertion.
 */

import * as ts from 'typescript';
import type { FileSymbols, Symbol, SymbolKind, SymbolLang } from './schema.js';

// Map TypeScript SyntaxKind → our SymbolKind taxonomy
const KIND_MAP: Partial<Record<ts.SyntaxKind, SymbolKind>> = {
  [ts.SyntaxKind.ClassDeclaration]:      'class',
  [ts.SyntaxKind.InterfaceDeclaration]: 'interface',
  [ts.SyntaxKind.EnumDeclaration]:       'enum',
  [ts.SyntaxKind.TypeAliasDeclaration]:  'type',
  [ts.SyntaxKind.FunctionDeclaration]:    'function',
  [ts.SyntaxKind.MethodDeclaration]:     'method',
  [ts.SyntaxKind.GetAccessor]:           'property',
  [ts.SyntaxKind.SetAccessor]:           'property',
  [ts.SyntaxKind.PropertyDeclaration]:   'property',
  [ts.SyntaxKind.Parameter]:            'parameter',
  [ts.SyntaxKind.NamespaceExportDeclaration]: 'namespace',
};

function kindOf(node: ts.Node): SymbolKind | null {
  // VariableDeclaration needs special handling — its parent tells us whether
  // it's `const`, `let`, or `var`.
  if (ts.isVariableDeclaration(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclarationList(parent)) {
      const flags = parent.flags;
      if (flags & ts.NodeFlags.Let) return 'let';
      if (flags & ts.NodeFlags.Const) return 'const';
      return 'var';
    }
  }

  // Namespace (module) declaration
  if (ts.isModuleDeclaration(node)) return 'namespace';

  return KIND_MAP[node.kind] ?? null;
}

function extToLang(ext: string): SymbolLang | null {
  switch (ext) {
    case '.ts':   return 'ts';
    case '.tsx':  return 'tsx';
    case '.js':   return 'js';
    case '.jsx':  return 'jsx';
    default:      return null;
  }
}

function getSignature(node: ts.Declaration, sourceFile: ts.SourceFile): string {
  const printer = ts.createPrinter({});
  const raw = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
  return raw.replace(/\s+/g, ' ').slice(0, 500);
}

/**
 * Extract the first line of a JSDoc comment preceding a node.
 * Uses `ts.getLeadingCommentRanges` which is the modern replacement for
 * the removed `ts.getJSDocComments`.
 */
function getJsDoc(node: ts.Node, sourceFile: ts.SourceFile): string {
  const fullText = sourceFile.getFullText();
  const nodePos = node.getFullWidth();
  const comments = ts.getLeadingCommentRanges(fullText, nodePos);
  if (!comments) return '';

  for (const range of comments) {
    const commentText = fullText.slice(range.pos, range.end);
    // Only process JSDoc comments (/** ... */)
    const trimmed = commentText.trim();
    if (trimmed.startsWith('/**') && trimmed.endsWith('*/')) {
      // Strip the /** and */ delimiters and leading * on each line
      const inner = trimmed
        .slice(3, -2)              // remove /** and */
        .replace(/^[ \t]*\*[ ]?/gm, '')  // remove leading " * " or " *" on each line
        .trim();
      return inner.split('\n')[0]?.trim().slice(0, 200) ?? '';
    }
  }
  return '';
}

/** Build the scope path from a node up to the root (for class-method scope). */
function buildScope(node: ts.Node): string {
  const parts: string[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isClassDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isEnumDeclaration(current) ||
      ts.isTypeAliasDeclaration(current)
    ) {
      parts.unshift(current.name?.text ?? 'Anon');
    } else if (
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessor(current) ||
      ts.isSetAccessor(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isFunctionDeclaration(current)
    ) {
      if (current.name && ts.isIdentifier(current.name)) {
        parts.unshift(current.name.text);
      }
    }
    current = current.parent;
  }
  return parts.join('.');
}

export interface ParseOptions {
  file: string;
  content: string;
  lang: SymbolLang;
}

/**
 * Parse a TypeScript/JavaScript source file and extract all code symbols.
 *
 * The returned `Symbol.id` field is always `0` — the caller is responsible
 * for assigning unique numeric ids during bulk insertion.
 *
 * Returns an empty array for files that can't be parsed or contain no symbols.
 */
export function parseSymbols(opts: ParseOptions): FileSymbols {
  const { file, content, lang } = opts;

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  } catch {
    return { file, lang, symbols: [], mtimeMs: Date.now() };
  }

  const symbols: Symbol[] = [];

  function visit(node: ts.Node): void {
    const kind = kindOf(node);

    if (kind) {
      const nameNode = (node as { name?: ts.Identifier }).name;
      if (!nameNode || !ts.isIdentifier(nameNode)) return;
      const name = nameNode.text;
      const pos = nameNode.getStart(sourceFile);
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
      const scope = buildScope(node);
      const signature = getSignature(node as ts.Declaration, sourceFile);
      const docComment = getJsDoc(node, sourceFile);
      const text = [name, signature, docComment].filter(Boolean).join(' | ');

      symbols.push({
        id: 0,
        lang,
        kind,
        name,
        file,
        line: line + 1,
        col: character,
        signature,
        docComment,
        scope,
        text,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return { file, lang, symbols, mtimeMs: Date.now() };
}

/** Detect SymbolLang from a file path extension. */
export function detectLang(file: string): SymbolLang | null {
  const idx = file.lastIndexOf('.');
  if (idx < 0) return null;
  return extToLang(file.slice(idx));
}