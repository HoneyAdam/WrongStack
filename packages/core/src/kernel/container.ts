/**
 * Container — dependency injection with explicit bind / override / decorate.
 *
 * Invariants:
 *   bind()     — throws if token already bound
 *   override() — throws if nothing to replace
 *   decorate() — stacks; cached value cleared on register
 */

export type Token<T> = symbol & { readonly __type?: T };
export type Factory<T> = (c: Container) => T;
export type Decorator<T> = (inner: T, c: Container) => T;

interface Entry<T = unknown> {
  factory: Factory<T>;
  singleton: boolean;
  decorators: Decorator<T>[];
  cache?: T;
  owner: string;
}

export interface BindOptions {
  singleton?: boolean;
  owner?: string;
}

export class Container {
  private readonly entries = new Map<symbol, Entry>();

  bind<T>(token: Token<T>, factory: Factory<T>, opts: BindOptions = {}): void {
    if (this.entries.has(token)) {
      throw new Error(`Container: token "${token.description ?? 'unknown'}" already bound`);
    }
    this.entries.set(token, {
      factory: factory as Factory<unknown>,
      singleton: opts.singleton ?? true,
      decorators: [],
      owner: opts.owner ?? 'core',
    });
  }

  override<T>(token: Token<T>, factory: Factory<T>, opts: BindOptions = {}): void {
    const existing = this.entries.get(token);
    if (!existing) {
      throw new Error(
        `Container: cannot override "${token.description ?? 'unknown'}" — not bound`,
      );
    }
    this.entries.set(token, {
      factory: factory as Factory<unknown>,
      singleton: opts.singleton ?? existing.singleton,
      decorators: existing.decorators,
      owner: opts.owner ?? existing.owner,
    });
  }

  decorate<T>(token: Token<T>, decorator: Decorator<T>, owner = 'core'): void {
    const existing = this.entries.get(token);
    if (!existing) {
      throw new Error(
        `Container: cannot decorate "${token.description ?? 'unknown'}" — not bound`,
      );
    }
    existing.decorators.push(decorator as Decorator<unknown>);
    existing.cache = undefined;
    existing.owner = `${existing.owner}+${owner}`;
  }

  resolve<T>(token: Token<T>): T {
    const entry = this.entries.get(token);
    if (!entry) {
      throw new Error(
        `Container: token "${token.description ?? 'unknown'}" not bound`,
      );
    }
    if (entry.singleton && entry.cache !== undefined) {
      return entry.cache as T;
    }
    let value: unknown = entry.factory(this);
    for (const d of entry.decorators) {
      value = d(value, this);
    }
    if (entry.singleton) {
      entry.cache = value;
    }
    return value as T;
  }

  has<T>(token: Token<T>): boolean {
    return this.entries.has(token);
  }

  ownerOf<T>(token: Token<T>): string | undefined {
    return this.entries.get(token)?.owner;
  }

  list(): Array<{ token: symbol; owner: string }> {
    return Array.from(this.entries.entries()).map(([token, entry]) => ({
      token,
      owner: entry.owner,
    }));
  }
}
