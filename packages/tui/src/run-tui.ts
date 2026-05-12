import React from 'react';
import { render } from 'ink';
import type {
  Agent,
  AttachmentStore,
  EventBus,
  SlashCommandRegistry,
  TokenCounter,
} from '@wrongstack/core';
import { App } from './app.js';

export interface RunTuiOptions {
  agent: Agent;
  slashRegistry: SlashCommandRegistry;
  attachments: AttachmentStore;
  events: EventBus;
  tokenCounter?: TokenCounter;
  model: string;
  banner?: boolean;
}

export async function runTui(opts: RunTuiOptions): Promise<number> {
  return new Promise<number>((resolve) => {
    let exitCode = 0;
    const onExit = (code: number) => {
      exitCode = code;
    };
    const instance = render(
      React.createElement(App, {
        agent: opts.agent,
        slashRegistry: opts.slashRegistry,
        attachments: opts.attachments,
        events: opts.events,
        tokenCounter: opts.tokenCounter,
        model: opts.model,
        banner: opts.banner ?? true,
        onExit,
      }),
      { exitOnCtrlC: false },
    );
    instance
      .waitUntilExit()
      .then(() => resolve(exitCode))
      .catch(() => resolve(1));
  });
}
