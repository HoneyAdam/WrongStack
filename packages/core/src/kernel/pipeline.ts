/**
 * Pipeline — Koa-style middleware chain with named middleware
 * and position-aware insertion. Generic over input type T.
 */

export type NextFn<T> = (value: T) => Promise<T>;
export type MiddlewareHandler<T> = (value: T, next: NextFn<T>) => Promise<T>;

export interface Middleware<T> {
  name: string;
  handler: MiddlewareHandler<T>;
  owner?: string;
}

export class Pipeline<T> {
  private readonly chain: Middleware<T>[] = [];

  use(mw: Middleware<T>): this {
    this.ensureUnique(mw.name);
    this.chain.push(mw);
    return this;
  }

  prepend(mw: Middleware<T>): this {
    this.ensureUnique(mw.name);
    this.chain.unshift(mw);
    return this;
  }

  insertBefore(target: string, mw: Middleware<T>): this {
    this.ensureUnique(mw.name);
    const idx = this.indexOf(target);
    this.chain.splice(idx, 0, mw);
    return this;
  }

  insertAfter(target: string, mw: Middleware<T>): this {
    this.ensureUnique(mw.name);
    const idx = this.indexOf(target);
    this.chain.splice(idx + 1, 0, mw);
    return this;
  }

  replace(target: string, mw: Middleware<T>): this {
    if (mw.name !== target) this.ensureUnique(mw.name);
    const idx = this.indexOf(target);
    this.chain[idx] = mw;
    return this;
  }

  remove(name: string): this {
    const idx = this.indexOf(name);
    if (idx !== -1) {
      this.chain.splice(idx, 1);
    }
    return this;
  }

  list(): readonly string[] {
    return this.chain.map((m) => m.name);
  }

  size(): number {
    return this.chain.length;
  }

  async run(input: T): Promise<T> {
    let index = -1;
    const chain = this.chain;

    const dispatch = async (i: number, value: T): Promise<T> => {
      if (i <= index) {
        throw new Error(`Pipeline: next() called multiple times in "${chain[index]?.name}"`);
      }
      index = i;
      const mw = chain[i];
      if (!mw) return value;
      return mw.handler(value, (v) => dispatch(i + 1, v));
    };

    return dispatch(0, input);
  }

  private indexOf(name: string): number {
    const idx = this.chain.findIndex((m) => m.name === name);
    if (idx === -1) throw new Error(`Pipeline: middleware "${name}" not found`);
    return idx;
  }

  private ensureUnique(name: string): void {
    if (this.chain.some((m) => m.name === name)) {
      throw new Error(`Pipeline: middleware "${name}" already registered`);
    }
  }
}
