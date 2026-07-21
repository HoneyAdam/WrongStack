/**
 * Dependency-free wire contracts shared by the embedded CLI WebUI host.
 *
 * Keep these shapes outside `webui-server.ts`: connection and routing modules
 * are dependencies of that composition root and must not import back from it.
 */
export interface WSServerMessage {
  type: string;
  payload: unknown;
}

export interface WSClientMessage {
  type: string;
  payload?: unknown | undefined;
}
