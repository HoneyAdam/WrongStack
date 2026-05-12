export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface Logger {
  level: LogLevel;
  error(msg: string, ctx?: unknown): void;
  warn(msg: string, ctx?: unknown): void;
  info(msg: string, ctx?: unknown): void;
  debug(msg: string, ctx?: unknown): void;
  trace(msg: string, ctx?: unknown): void;
  child(bindings: Record<string, unknown>): Logger;
}
