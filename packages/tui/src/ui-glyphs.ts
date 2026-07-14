/** A coherent, switchable glyph language for TUI chrome. */

export type IconStyle = 'unicode' | 'nerd' | 'ascii';

export interface UiGlyphs {
  brand: string;
  prompt: string;
  success: string;
  failure: string;
  warning: string;
  info: string;
  idle: string;
  running: string;
  pending: string;
  folder: string;
  workingDirectory: string;
  goal: string;
  clock: string;
  gitBranch: string;
  sessions: string;
  tools: string;
  save: string;
  audit: string;
  plan: string;
  task: string;
  fleet: string;
  bug: string;
  mail: string;
  peers: string;
  desktop: string;
  web: string;
  terminal: string;
  context: string;
  cost: string;
  index: string;
  queue: string;
  process: string;
  brain: string;
  auto: string;
  segmentStart: string;
  segmentTransition: string;
  segmentEnd: string;
}

const UNICODE: UiGlyphs = Object.freeze({
  brand: '◆',
  prompt: '❯',
  success: '✓',
  failure: '×',
  warning: '!',
  info: 'i',
  idle: '●',
  running: '▶',
  pending: '○',
  folder: '▣',
  workingDirectory: '⌁',
  goal: '◎',
  clock: '◷',
  gitBranch: '⎇',
  sessions: '⧉',
  tools: '⚙',
  save: '▰',
  audit: '△',
  plan: '☷',
  task: '◆',
  fleet: '◈',
  bug: '◇',
  mail: '✉',
  peers: '⧉',
  desktop: '▤',
  web: '◈',
  terminal: '⌘',
  context: '◔',
  cost: '$',
  index: '⊛',
  queue: '◴',
  process: '⚡',
  brain: '✦',
  auto: '◴',
  segmentStart: '◖',
  segmentTransition: '▶',
  segmentEnd: '◗',
});

// Optional Nerd Font profile. WrongStack never assumes this font is present;
// users opt in with WRONGSTACK_TUI_ICON_STYLE=nerd.
const NERD: UiGlyphs = Object.freeze({
  ...UNICODE,
  brand: '󰚩',
  prompt: '❯',
  folder: '󰉋',
  workingDirectory: '󰉋',
  goal: '󰄉',
  clock: '󰥔',
  gitBranch: '',
  sessions: '󰍹',
  tools: '󰒓',
  save: '󰆓',
  plan: '󰈙',
  task: '󰄬',
  fleet: '󰓾',
  bug: '󰃤',
  mail: '󰇮',
  peers: '󰀉',
  desktop: '󰍹',
  web: '󰖟',
  terminal: '',
  context: '󰓡',
  index: '󰌨',
  brain: '󰧑',
  segmentStart: '',
  segmentTransition: '',
  segmentEnd: '',
});

const ASCII: UiGlyphs = Object.freeze({
  brand: '*',
  prompt: '>',
  success: '+',
  failure: 'x',
  warning: '!',
  info: 'i',
  idle: 'o',
  running: '>',
  pending: '.',
  folder: 'd',
  workingDirectory: '/',
  goal: '@',
  clock: 't',
  gitBranch: 'git',
  sessions: '#',
  tools: '*',
  save: 's',
  audit: '!',
  plan: '=',
  task: '+',
  fleet: '%',
  bug: 'b',
  mail: 'm',
  peers: 'p',
  desktop: 'T',
  web: 'W',
  terminal: '$',
  context: 'c',
  cost: '$',
  index: 'i',
  queue: 'q',
  process: '!',
  brain: '*',
  auto: 'a',
  segmentStart: '[',
  segmentTransition: '>',
  segmentEnd: ']',
});

export function resolveIconStyle(env: NodeJS.ProcessEnv = process.env): IconStyle {
  const raw = env.WRONGSTACK_TUI_ICON_STYLE?.trim().toLowerCase();
  if (raw === 'nerd' || raw === 'nerd-font' || raw === 'nerdfont') return 'nerd';
  if (raw === 'ascii' || raw === 'plain') return 'ascii';
  return 'unicode';
}

export function glyphSet(style: IconStyle = resolveIconStyle()): UiGlyphs {
  if (style === 'nerd') return NERD;
  if (style === 'ascii') return ASCII;
  return UNICODE;
}

export const glyphs = glyphSet();
