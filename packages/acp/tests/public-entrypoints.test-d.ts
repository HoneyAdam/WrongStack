import type { SessionUpdate as RootSessionUpdate } from '../src/index.js';
import type { ACPMessage } from '../src/legacy.js';
import type { AgentApp as OfficialAgentApp } from '../src/sdk.js';
import type { SessionUpdate as V1SessionUpdate } from '../src/v1.js';

declare const update: V1SessionUpdate;
const rootUpdate: RootSessionUpdate = update;
void rootUpdate;

declare const legacyMessage: ACPMessage;
void legacyMessage;

declare const officialAgent: OfficialAgentApp;
void officialAgent;

// @ts-expect-error Pre-v1 draft envelopes are intentionally absent from root.
type RootLegacyMessage = import('../src/index.js').ACPMessage;
declare const rootLegacyMessage: RootLegacyMessage;
void rootLegacyMessage;
