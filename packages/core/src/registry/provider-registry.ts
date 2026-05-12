import type { Provider } from '../types/provider.js';
import type { ProviderConfig } from '../types/config.js';

export interface ProviderFactory {
  type: string;
  create(cfg: ProviderConfig): Provider;
}

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  register(f: ProviderFactory): void {
    this.factories.set(f.type, f);
  }

  has(type: string): boolean {
    return this.factories.has(type);
  }

  create(cfg: ProviderConfig): Provider {
    const f = this.factories.get(cfg.type);
    if (!f) {
      throw new Error(
        `Provider type "${cfg.type}" not registered. Available: ${Array.from(this.factories.keys()).join(', ')}`,
      );
    }
    return f.create(cfg);
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }
}
