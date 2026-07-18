import {
  ChronicleQueryEngine,
  resolveWstackPaths,
  type ChronicleFacet,
  type ChronicleQuery,
} from '@wrongstack/core';
import type { SubcommandHandler } from '../index.js';

const facets = new Set<ChronicleFacet>([
  'eventType', 'outcome', 'projectId', 'sessionId', 'agentId', 'taskId',
  'providerId', 'modelId', 'resourceKind', 'resourcePath', 'toolCallId',
]);

/** `wstack chronicle` — query the cross-session provenance ledger. */
export const chronicleCmd: SubcommandHandler = async (args, deps) => {
  const paths = resolveWstackPaths({ projectRoot: deps.projectRoot, userHome: deps.userHome });
  const engine = await ChronicleQueryEngine.fromDirectory(paths.projectDir + '/chronicle');
  const operation = args[0] ?? 'query';
  if (operation === 'help' || operation === '--help' || operation === '-h') {
    deps.renderer.write(usage());
    return 0;
  }
  if (operation === 'facet') {
    const field = args[1] as ChronicleFacet | undefined;
    if (!field || !facets.has(field)) {
      deps.renderer.writeError(`Unknown facet. Use: ${[...facets].join(', ')}\n`);
      return 1;
    }
    const query = parseQuery(args.slice(2));
    deps.renderer.write(JSON.stringify({ field, values: engine.facet(field, query), diagnostics: engine.diagnostics }, null, 2) + '\n');
    return 0;
  }
  if (operation !== 'query') {
    deps.renderer.writeError(`Unknown Chronicle operation: ${operation}\n${usage()}`);
    return 1;
  }
  const result = engine.query(parseQuery(args.slice(1)));
  deps.renderer.write(JSON.stringify(result, null, 2) + '\n');
  return 0;
};

function parseQuery(tokens: string[]): ChronicleQuery {
  const query: ChronicleQuery = {};
  for (const token of tokens) {
    const split = token.indexOf('=');
    if (split < 1) continue;
    const key = token.slice(0, split), value = token.slice(split + 1);
    if (key === 'eventType') query.eventTypes = value.split(',').filter(Boolean);
    else if (key === 'outcome') query.outcomes = value.split(',').filter(Boolean) as NonNullable<ChronicleQuery['outcomes']>;
    else if (key === 'resourceKind') query.resourceKind = value as NonNullable<ChronicleQuery['resourceKind']>;
    else if (key === 'line' || key === 'limit') query[key] = Number(value);
    else if (key === 'order' && (value === 'asc' || value === 'desc')) query.order = value;
    else if (key.startsWith('tag.')) (query.tags ??= {})[key.slice(4)] = value;
    else if (key.startsWith('attr.')) (query.attributes ??= {})[key.slice(5)] = parseValue(value);
    else if (isStringQueryKey(key)) query[key] = value;
  }
  return query;
}

function isStringQueryKey(key: string): key is 'from' | 'to' | 'projectId' | 'sessionId' | 'agentId' |
  'taskId' | 'providerId' | 'modelId' | 'traceId' | 'logicalRequestId' | 'attemptId' |
  'toolCallId' | 'resourceId' | 'path' | 'text' | 'cursor' {
  return ['from', 'to', 'projectId', 'sessionId', 'agentId', 'taskId', 'providerId', 'modelId',
    'traceId', 'logicalRequestId', 'attemptId', 'toolCallId', 'resourceId', 'path', 'text', 'cursor'].includes(key);
}

function parseValue(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

function usage(): string {
  return 'Usage:\n' +
    '  wstack chronicle query [field=value ...]\n' +
    '  wstack chronicle facet <field> [field=value ...]\n\n' +
    'Examples:\n' +
    '  wstack chronicle query path=src/app.ts line=42\n' +
    '  wstack chronicle query providerId=openai outcome=failure\n' +
    '  wstack chronicle query eventType=tool.executed sessionId=<id> limit=50\n' +
    '  wstack chronicle query attr.tool.name=read\n' +
    '  wstack chronicle facet modelId from=2026-07-01T00:00:00Z\n';
}
