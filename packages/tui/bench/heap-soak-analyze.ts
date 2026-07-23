import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { analyzeHeapSnapshotFile } from './heap-snapshot-dominators.js';

interface AnalysisOptions {
  scenario: string;
  output: string;
  top: number;
}

function parseArgs(argv: readonly string[]): AnalysisOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Expected --name value pairs; invalid argument near ${key ?? '<end>'}`);
    }
    values.set(key.slice(2), value);
  }
  const top = Number(values.get('top') ?? '25');
  if (!Number.isSafeInteger(top) || top <= 0) throw new Error(`top must be positive, got ${top}`);
  const scenario = values.get('scenario');
  const output = values.get('output');
  if (!scenario || !output) throw new Error('--scenario and --output are required');
  return { scenario: resolve(scenario), output: resolve(output), top };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const scenario = JSON.parse(await readFile(options.scenario, 'utf8')) as {
    artifacts?: { mountedSnapshot?: string | null; unmountedSnapshot?: string | null };
  };
  const mountedPath = scenario.artifacts?.mountedSnapshot;
  const unmountedPath = scenario.artifacts?.unmountedSnapshot;
  if (!mountedPath) throw new Error(`Scenario ${options.scenario} has no mounted heap snapshot`);

  const mounted = await analyzeHeapSnapshotFile(mountedPath, options.top);
  const unmounted = unmountedPath
    ? await analyzeHeapSnapshotFile(unmountedPath, options.top)
    : null;
  const report = {
    schemaVersion: 1,
    scenario: options.scenario,
    mounted,
    unmounted,
  };
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

await main();
