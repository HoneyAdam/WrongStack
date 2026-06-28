import { modePrompt } from './mode-prompts.js';
export interface Mode {
  id: string;
  name: string;
  description: string;
  /** Additional prompt text injected into system prompt when mode is active */
  prompt: string;
  /** Tags for tool_search filtering */
  tags?: string[] | undefined;
  /** Tools that should be prioritized/highlighted when this mode is active */
  toolPreferences?: string[] | undefined;
  /**
   * Skill names that are particularly relevant to this mode. The system
   * prompt builder appends a "Suggested skills" note so the model knows
   * which domain knowledge to leverage first. Skill must exist in the
   * loaded skill set to appear.
   */
  suggestedSkills?: string[] | undefined;
}

export interface ModeManifest {
  modes: Mode[];
  defaultMode?: string | undefined;
}

export interface ModeStore {
  getActiveMode(): Promise<Mode | null>;
  setActiveMode(modeId: string | null): Promise<void>;
  listModes(): Promise<Mode[]>;
  getMode(modeId: string): Promise<Mode | null>;
}

export interface ModeConfig {
  directory: string;
}

export const DEFAULT_MODES: Mode[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'General-purpose coding assistant',
    prompt: '',
    tags: ['general'],
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Focus on code quality, best practices, and potential bugs',
    prompt: modePrompt('code-reviewer'),
    tags: ['review', 'quality', 'security'],
    toolPreferences: ['read', 'grep', 'git', 'diff', 'test'],
    suggestedSkills: ['bug-hunter', 'security-scanner', 'typescript-strict', 'testing'],
  },
  {
    id: 'code-auditor',
    name: 'Code Auditor',
    description: 'Security-focused code analysis',
    prompt: modePrompt('code-auditor'),
    tags: ['security', 'audit', 'compliance'],
    toolPreferences: ['grep', 'read', 'audit', 'bash'],
    suggestedSkills: ['security-scanner', 'bug-hunter', 'audit-log'],
  },
  {
    id: 'architect',
    name: 'Software Architect',
    description: 'Design patterns, scalability, and system design',
    prompt: modePrompt('architect'),
    tags: ['architecture', 'design', 'scalability'],
    toolPreferences: ['read', 'glob', 'tree', 'diff'],
    suggestedSkills: ['api-design', 'refactor-planner', 'node-modern', 'docker-deploy'],
  },
  {
    id: 'debugger',
    name: 'Debugger',
    description: 'Root cause analysis and error investigation',
    prompt: modePrompt('debugger'),
    tags: ['debug', 'investigation', 'error-resolution'],
    toolPreferences: ['read', 'grep', 'bash', 'logs', 'test'],
    suggestedSkills: ['bug-hunter', 'audit-log', 'observability'],
  },
  {
    id: 'tester',
    name: 'QA Engineer',
    description: 'Test coverage, edge cases, and quality assurance',
    prompt: modePrompt('tester'),
    tags: ['testing', 'qa', 'quality'],
    toolPreferences: ['read', 'grep', 'test', 'bash'],
    suggestedSkills: ['testing', 'bug-hunter', 'typescript-strict'],
  },
  {
    id: 'devops',
    name: 'DevOps Engineer',
    description: 'Infrastructure, deployment, and operations',
    prompt: modePrompt('devops'),
    tags: ['devops', 'infrastructure', 'operations'],
    toolPreferences: ['read', 'bash', 'grep', 'logs', 'git'],
    suggestedSkills: ['docker-deploy', 'observability', 'security-scanner'],
  },
  {
    id: 'refactorer',
    name: 'Refactorer',
    description: 'Code improvement and modernization',
    prompt: modePrompt('refactorer'),
    tags: ['refactor', 'modernization', 'improvement'],
    toolPreferences: ['read', 'edit', 'test', 'git', 'grep'],
    suggestedSkills: ['refactor-planner', 'typescript-strict', 'node-modern', 'testing'],
  },
  {
    id: 'ui-design',
    name: 'UI Design',
    description: 'Design-first frontend & mobile UI work (Design Studio)',
    prompt: modePrompt('ui-design'),
    tags: ['ui', 'frontend', 'mobile', 'design'],
    toolPreferences: ['design', 'write', 'edit', 'read', 'scaffold'],
    suggestedSkills: ['react-modern'],
  },
  {
    id: 'brief',
    name: 'Brief',
    description: 'Fast, no-nonsense — get to the point',
    prompt: modePrompt('brief'),
    tags: ['fast', 'concise', 'direct'],
    toolPreferences: ['read', 'edit', 'bash'],
    suggestedSkills: [],
  },
  {
    id: 'teach',
    name: 'Teach',
    description: 'Mentor mode — explains why, not just what',
    prompt: modePrompt('teach'),
    tags: ['teaching', 'mentor', 'learning'],
    toolPreferences: ['read', 'edit', 'explain'],
    suggestedSkills: ['prompt-engineering', 'skill-creator', 'node-modern', 'typescript-strict'],
  },
  {
    id: 'research-web',
    name: 'Research Web',
    description: 'Current-data research — search web, verify, inject findings into context',
    prompt: modePrompt('research-web'),
    tags: ['research', 'web', 'current-data', 'up-to-date'],
    toolPreferences: ['web_search', 'web_fetch', 'search', 'fetch', 'context_manager'],
    suggestedSkills: ['research-web', 'tech-stack', 'node-modern', 'security-scanner', 'react-modern'],
  },
];
