import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import {
  DefaultConfigLoader,
  DefaultLogger,
  DefaultPathResolver,
  DefaultSecretVault,
  type Config,
  type WstackPaths,
  migratePlaintextSecrets,
  resolveWstackPaths,
  writeErr,
} from '@wrongstack/core';

export interface BootResult {
  config: Config;
  vault: DefaultSecretVault;
  globalConfigPath: string;
  projectRoot: string;
  wpaths: WstackPaths;
  logger: InstanceType<typeof DefaultLogger>;
}

/**
 * Boot config the same way the CLI does (mirrors packages/cli/src/boot-config.ts):
 *   - resolve wstack paths
 *   - create the real DefaultSecretVault (AES-GCM, not XOR)
 *   - migrate any plaintext secrets in config files to encrypted form
 *   - load + merge global/project config with apiKeys auto-decrypted
 */
export async function bootConfig(): Promise<BootResult> {
  const cwd = process.cwd();
  const pathResolver = new DefaultPathResolver(cwd);
  const projectRoot = pathResolver.projectRoot;
  const userHome = os.homedir();
  const wpaths = resolveWstackPaths({ projectRoot, userHome });

  await fs.mkdir(wpaths.globalRoot, { recursive: true });
  await fs.mkdir(wpaths.projectDir, { recursive: true });
  await fs.mkdir(wpaths.projectSessions, { recursive: true });

  const vault = new DefaultSecretVault({ keyFile: wpaths.secretsKey });

  for (const file of [wpaths.globalConfig, wpaths.projectLocalConfig]) {
    try {
      const { migrated } = await migratePlaintextSecrets(file, vault);
      if (migrated > 0) {
        writeErr(`[WebUI] Encrypted ${migrated} plaintext secret(s) in ${file}\n`);
      }
    } catch {
      // best-effort
    }
  }

  const configLoader = new DefaultConfigLoader({ paths: wpaths, vault });
  const config = await configLoader.load({ cliFlags: {} });

  const logger = new DefaultLogger({
    level: config.log?.level ?? 'info',
    file: wpaths.logFile,
  });

  return { config, vault, globalConfigPath: wpaths.globalConfig, projectRoot, wpaths, logger };
}

export function patchConfig(config: Config, updates: Partial<Config>): Config {
  return Object.freeze({ ...config, ...updates });
}
