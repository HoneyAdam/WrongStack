/**
 * Project-level agent identity, override and learning layer.
 *
 * Every built-in roster agent has a base definition (role + prompt + tools +
 * skills) in the catalog. On top of that, **each project** can:
 *
 * 1. Override prompt, tools, skills, budget per role
 * 2. Accumulate learned wisdom specific to this codebase
 * 3. Attach a project-custom identity (name, avatar, tone)
 *
 * Resolution cascade (most → least specific):
 *   activeLearning.json  →  project-identity.md  →  catalog base
 *
 * Files live under `.wrongstack/agents/<role>/`:
 *   config.json   — static overrides (tools, budget, skillNames)
 *   identity.md   — custom prompt appendix (tone, project-specific rules)
 *   learned.md    — auto-generated wisdom from past sessions
 *   knowledge.md  — current-needs checklist (what versions to verify today)
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import type { SubagentConfig } from '../../types/multi-agent.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectAgentConfig {
  /**
   * Static tool allowlist override. When set, replaces the catalog tools
   * entirely (not merged). Omit to keep catalog defaults.
   */
  tools?: string[] | undefined;
  /** Static skill name override. Replaces catalog skillNames entirely. */
  skillNames?: string[] | undefined;
  /**
   * Budget overrides. Each field individually overrides the catalog budget.
   */
  budget?:
    | {
        timeoutMs?: number | undefined;
        idleTimeoutMs?: number | undefined;
        maxIterations?: number | undefined;
        maxToolCalls?: number | undefined;
        maxTokens?: number | undefined;
        maxCostUsd?: number | undefined;
      }
    | undefined;
  /** Provider/model override for this role within the project. */
  provider?: string | undefined;
  model?: string | undefined;
  modelPolicy?:
    | {
        allowed: Array<{ provider: string; model: string }>;
        fallbacks?: Array<{ provider: string; model: string }> | undefined;
        strict?: boolean | undefined;
      }
    | undefined;
  fallbackProfile?: string | undefined;
  /** Project-relative directory, resolved inside the assigned checkout/worktree. */
  cwd?: string | undefined;
  worktree?: boolean | 'auto' | 'required' | 'off' | undefined;
  availability?:
    | {
        timezone: string;
        days: number[];
        start: string;
        end: string;
        mode?: 'advisory' | 'enforce' | undefined;
      }
    | undefined;
  /**
   * Allowed capability overrides. Replaces catalog capabilities entirely.
   */
  allowedCapabilities?: readonly string[] | undefined;
}

/** Durable definition for a project-created roster role. */
export interface ProjectAgentProfile {
  role: string;
  name: string;
  baseRole: string;
  purpose: string;
  taskTypes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectAgentInput {
  role?: string | undefined;
  name: string;
  purpose: string;
  taskTypes: string[];
  baseRole?: string | undefined;
}

const PROJECT_AGENT_CONFIG_KEYS = new Set([
  'tools',
  'skillNames',
  'budget',
  'provider',
  'model',
  'allowedCapabilities',
  'modelPolicy',
  'fallbackProfile',
  'cwd',
  'worktree',
  'availability',
]);

const PROJECT_AGENT_BUDGET_KEYS = new Set([
  'timeoutMs',
  'idleTimeoutMs',
  'maxIterations',
  'maxToolCalls',
  'maxTokens',
  'maxCostUsd',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertStringList(value: unknown, field: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
  ) {
    throw new Error(`Project agent config "${field}" must be an array of non-empty strings.`);
  }
}

/** Validate untrusted JSON before it can alter a roster agent runtime. */
export function validateProjectAgentConfig(value: unknown): ProjectAgentConfig {
  if (!isPlainRecord(value)) throw new Error('Project agent config must be an object.');

  const unknownKey = Object.keys(value).find((key) => !PROJECT_AGENT_CONFIG_KEYS.has(key));
  if (unknownKey) throw new Error(`Unknown project agent config field: "${unknownKey}".`);

  if (value.tools !== undefined) assertStringList(value.tools, 'tools');
  if (value.skillNames !== undefined) assertStringList(value.skillNames, 'skillNames');
  if (value.allowedCapabilities !== undefined) {
    assertStringList(value.allowedCapabilities, 'allowedCapabilities');
  }
  for (const field of ['provider', 'model', 'fallbackProfile'] as const) {
    const fieldValue = value[field];
    if (fieldValue !== undefined && (typeof fieldValue !== 'string' || !fieldValue.trim())) {
      throw new Error(`Project agent config "${field}" must be a non-empty string.`);
    }
  }

  if (value.cwd !== undefined) {
    if (typeof value.cwd !== 'string' || !value.cwd.trim()) {
      throw new Error('Project agent config "cwd" must be a non-empty relative path.');
    }
    const cwd = value.cwd.replace(/\\/g, '/').trim();
    if (path.posix.isAbsolute(cwd) || /^[a-z]:\//i.test(cwd) || cwd.split('/').includes('..')) {
      throw new Error('Project agent config "cwd" must stay inside the assigned checkout.');
    }
  }
  if (
    value.worktree !== undefined &&
    value.worktree !== true &&
    value.worktree !== false &&
    value.worktree !== 'auto' &&
    value.worktree !== 'required' &&
    value.worktree !== 'off'
  ) {
    throw new Error('Project agent config "worktree" must be auto, required, off, or boolean.');
  }

  if (value.modelPolicy !== undefined) validateProjectAgentModelPolicy(value.modelPolicy);
  if (value.availability !== undefined) validateProjectAgentAvailability(value.availability);

  if (value.budget !== undefined) {
    if (!isPlainRecord(value.budget)) {
      throw new Error('Project agent config "budget" must be an object.');
    }
    const unknownBudgetKey = Object.keys(value.budget).find(
      (key) => !PROJECT_AGENT_BUDGET_KEYS.has(key),
    );
    if (unknownBudgetKey) {
      throw new Error(`Unknown project agent budget field: "${unknownBudgetKey}".`);
    }
    for (const [field, amount] of Object.entries(value.budget)) {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        throw new Error(`Project agent budget "${field}" must be a finite non-negative number.`);
      }
      if (field !== 'maxCostUsd' && !Number.isInteger(amount)) {
        throw new Error(`Project agent budget "${field}" must be an integer.`);
      }
    }
  }

  return value as ProjectAgentConfig;
}

function validateProjectAgentModelPolicy(value: unknown): void {
  if (!isPlainRecord(value)) throw new Error('Project agent modelPolicy must be an object.');
  const allowedKeys = new Set(['allowed', 'fallbacks', 'strict']);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown modelPolicy field: "${unknownKey}".`);

  const validateTargets = (targets: unknown, field: string, allowEmpty: boolean) => {
    if (!Array.isArray(targets) || (!allowEmpty && targets.length === 0)) {
      throw new Error(`Project agent modelPolicy "${field}" must be a non-empty array.`);
    }
    for (const target of targets) {
      if (
        !isPlainRecord(target) ||
        typeof target.provider !== 'string' ||
        !target.provider.trim() ||
        typeof target.model !== 'string' ||
        !target.model.trim()
      ) {
        throw new Error(`Project agent modelPolicy "${field}" contains an invalid target.`);
      }
    }
  };
  validateTargets(value.allowed, 'allowed', false);
  if (value.fallbacks !== undefined) {
    validateTargets(value.fallbacks, 'fallbacks', true);
    const allowed = new Set(
      (value.allowed as Array<{ provider: string; model: string }>).map(
        (target) => `${target.provider}\0${target.model}`,
      ),
    );
    for (const target of value.fallbacks as Array<{ provider: string; model: string }>) {
      if (!allowed.has(`${target.provider}\0${target.model}`)) {
        throw new Error('Every modelPolicy fallback must also appear in allowed.');
      }
    }
  }
  if (value.strict !== undefined && typeof value.strict !== 'boolean') {
    throw new Error('Project agent modelPolicy "strict" must be boolean.');
  }
}

function validateProjectAgentAvailability(value: unknown): void {
  if (!isPlainRecord(value)) throw new Error('Project agent availability must be an object.');
  const allowedKeys = new Set(['timezone', 'days', 'start', 'end', 'mode']);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown availability field: "${unknownKey}".`);
  if (typeof value.timezone !== 'string' || !value.timezone.trim()) {
    throw new Error('Project agent availability requires a timezone.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format();
  } catch {
    throw new Error(`Invalid project agent availability timezone: "${value.timezone}".`);
  }
  if (
    !Array.isArray(value.days) ||
    value.days.length === 0 ||
    value.days.some((day) => !Number.isInteger(day) || (day as number) < 0 || (day as number) > 6)
  ) {
    throw new Error('Project agent availability days must contain weekday numbers 0-6.');
  }
  if (
    typeof value.start !== 'string' ||
    typeof value.end !== 'string' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.end)
  ) {
    throw new Error('Project agent availability start/end must use HH:MM.');
  }
  if (value.mode !== undefined && value.mode !== 'advisory' && value.mode !== 'enforce') {
    throw new Error('Project agent availability mode must be advisory or enforce.');
  }
}

/** Persistent controls and counters for one roster role's learning loop. */
export interface ProjectAgentLearningPolicy {
  /** Retain knowledge but stop prompt injection and automatic capture when false. */
  enabled: boolean;
  lifetimeCaptureCount: number;
  lastCaptureAt?: string | undefined;
  lastCaptureSource?: 'automatic' | 'manual' | 'taught' | undefined;
}

export interface LearnedCaptureResult {
  role: string;
  captured: number;
  skipped: number;
  status: 'captured' | 'disabled' | 'empty_output' | 'no_blocks' | 'guarded' | 'quality_rejected';
  reason?: string | undefined;
}

const DEFAULT_LEARNING_POLICY: ProjectAgentLearningPolicy = {
  enabled: true,
  lifetimeCaptureCount: 0,
};

const AGENT_ROLE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/i;

export function assertProjectAgentRole(role: string): string {
  const normalized = role.trim();
  if (
    !AGENT_ROLE_PATTERN.test(normalized) ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error(`Invalid project agent role: "${role}".`);
  }
  return normalized;
}

/**
 * Current-knowledge manifest for a role: what live facts the agent should
 * fetch on every spawn to avoid hallucinating stale versions.
 */
export interface RoleKnowledgeManifest {
  role: string;
  /** Registry endpoints to query at spawn time, keyed by topic. */
  liveQueries: Record<string, { registry: string; key: string; description: string }>;
  /**
   * Human-readable checklist: "before answering questions about X, verify Y
   * from the live registry". Injected verbatim into the subagent prompt.
   */
  checklist: string[];
  /**
   * Minimum confidence threshold before the role should re-verify a live
   * source rather than relying on its own training data (0.0–1.0). Default 0.5.
   */
  verifyThreshold: number;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function agentsDir(projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  return path.join(root, '.wrongstack', 'agents');
}

function roleDir(role: string, projectRoot?: string): string {
  return path.join(agentsDir(projectRoot), assertProjectAgentRole(role));
}

function writeTextAtomically(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, 'utf8');
    renameSync(temporaryPath, filePath);
  } finally {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Best-effort cleanup after a failed rename.
    }
  }
}

function learningPolicyPath(role: string, projectRoot?: string): string {
  return path.join(roleDir(role, projectRoot), 'learning.json');
}

function projectAgentProfilePath(role: string, projectRoot?: string): string {
  return path.join(roleDir(role, projectRoot), 'profile.json');
}

export function slugifyProjectAgentRole(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 96);
  return assertProjectAgentRole(slug);
}

export function loadProjectAgentProfile(
  role: string,
  projectRoot?: string,
): ProjectAgentProfile | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(projectAgentProfilePath(role, projectRoot), 'utf8'),
    ) as Partial<ProjectAgentProfile>;
    const normalizedRole = assertProjectAgentRole(parsed.role ?? role);
    const baseRole = assertProjectAgentRole(parsed.baseRole ?? 'generic');
    if (normalizedRole !== assertProjectAgentRole(role)) return undefined;
    if (typeof parsed.name !== 'string' || !parsed.name.trim()) return undefined;
    if (typeof parsed.purpose !== 'string' || !parsed.purpose.trim()) return undefined;
    if (
      !Array.isArray(parsed.taskTypes) ||
      parsed.taskTypes.some((item) => typeof item !== 'string')
    ) {
      return undefined;
    }
    const createdAt =
      typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString();
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : createdAt;
    return {
      role: normalizedRole,
      name: parsed.name.trim(),
      baseRole,
      purpose: parsed.purpose.trim(),
      taskTypes: parsed.taskTypes.map((item) => item.trim()).filter(Boolean),
      createdAt,
      updatedAt,
    };
  } catch {
    return undefined;
  }
}

/** Create a new, independently-learning project role from a roster template. */
export function createProjectAgent(
  input: CreateProjectAgentInput,
  projectRoot?: string,
): ProjectAgentProfile {
  const name = input.name.trim();
  const purpose = input.purpose.trim();
  if (!name || name.length > 120) throw new Error('Project agent name must be 1-120 characters.');
  if (purpose.length < 10 || purpose.length > 4_000) {
    throw new Error('Project agent purpose must be 10-4000 characters.');
  }
  const role = assertProjectAgentRole(
    (input.role?.trim() || slugifyProjectAgentRole(name)).toLowerCase(),
  );
  const baseRole = assertProjectAgentRole((input.baseRole?.trim() || 'generic').toLowerCase());
  const taskTypes = [...new Set(input.taskTypes.map((item) => item.trim()).filter(Boolean))];
  if (
    taskTypes.length === 0 ||
    taskTypes.length > 32 ||
    taskTypes.some((item) => item.length > 160)
  ) {
    throw new Error('Project agent requires 1-32 task descriptions, each at most 160 characters.');
  }

  const dir = roleDir(role, projectRoot);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`Project agent role "${role}" already exists.`);
  }
  const now = new Date().toISOString();
  const profile: ProjectAgentProfile = {
    role,
    name,
    baseRole,
    purpose,
    taskTypes,
    createdAt: now,
    updatedAt: now,
  };
  const identity = [
    `# ${name}`,
    '',
    `You are the project-specific "${name}" agent (role: ${role}).`,
    '',
    '## Purpose',
    '',
    purpose,
    '',
    '## Primary task types',
    '',
    ...taskTypes.map((item) => `- ${item}`),
    '',
    'Learn durable project conventions from completed work, keep conclusions evidence-based, and stay within this assigned purpose.',
    '',
  ].join('\n');

  mkdirSync(dir, { recursive: true });
  writeTextAtomically(path.join(dir, 'identity.md'), identity);
  writeTextAtomically(
    projectAgentProfilePath(role, projectRoot),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
  return profile;
}

/**
 * Live roster overlay. Project policy is resolved lazily for both built-in and
 * project-created roles, so WebUI changes take effect on the next spawn without
 * rebuilding the Director. Built-in roles keep their safety floors; custom
 * roles may opt into a deliberately narrow runtime.
 */
export function createProjectAgentRoster(
  baseRoster: Record<string, SubagentConfig>,
  projectRoot?: string,
): Record<string, SubagentConfig> {
  const target = { ...baseRoster };
  const resolveRole = (role: string, resolving = new Set<string>()): SubagentConfig | undefined => {
    if (resolving.has(role)) return undefined;
    const isBuiltIn = Object.hasOwn(target, role);
    if (!isBuiltIn && !listProjectAgentRoles(projectRoot).includes(role)) return undefined;
    resolving.add(role);
    const profile = loadProjectAgentProfile(role, projectRoot);
    const template = isBuiltIn
      ? target[role]
      : profile
        ? (resolveRole(profile.baseRole, resolving) ?? target['generic'])
        : target['generic'];
    resolving.delete(role);
    if (!template) return undefined;
    const base = isBuiltIn
      ? template
      : {
          ...template,
          id: role,
          role,
          name: profile?.name ?? role,
          ...(profile
            ? {
                dispatch: {
                  summary: profile.purpose,
                  keywords: [
                    ...profile.taskTypes,
                    ...new Set(
                      `${profile.purpose} ${profile.taskTypes.join(' ')}`
                        .toLowerCase()
                        .split(/[^a-z0-9]+/)
                        .filter((word) => word.length >= 3),
                    ),
                  ],
                },
              }
            : {}),
        };
    return applyProjectAgentConfig(base, loadProjectAgentConfig(role, projectRoot), {
      protectSystemRole: isBuiltIn && !profile,
    });
  };

  return new Proxy(target, {
    get(current, property, receiver) {
      if (typeof property !== 'string') return Reflect.get(current, property, receiver);
      return resolveRole(property) ?? Reflect.get(current, property, receiver);
    },
    has(current, property) {
      return typeof property === 'string'
        ? Reflect.has(current, property) || resolveRole(property) !== undefined
        : Reflect.has(current, property);
    },
    ownKeys(current) {
      return [...new Set([...Reflect.ownKeys(current), ...listProjectAgentRoles(projectRoot)])];
    },
    getOwnPropertyDescriptor(current, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
      if (descriptor || typeof property !== 'string' || !resolveRole(property)) return descriptor;
      return {
        configurable: true,
        enumerable: true,
        writable: false,
        value: resolveRole(property),
      };
    },
  });
}

export function loadProjectAgentLearningPolicy(
  role: string,
  projectRoot?: string,
): ProjectAgentLearningPolicy {
  try {
    const parsed = JSON.parse(
      readFileSync(learningPolicyPath(role, projectRoot), 'utf8'),
    ) as Partial<ProjectAgentLearningPolicy>;
    return {
      enabled: parsed.enabled !== false,
      lifetimeCaptureCount:
        typeof parsed.lifetimeCaptureCount === 'number' &&
        Number.isInteger(parsed.lifetimeCaptureCount) &&
        parsed.lifetimeCaptureCount >= 0
          ? parsed.lifetimeCaptureCount
          : 0,
      ...(typeof parsed.lastCaptureAt === 'string' ? { lastCaptureAt: parsed.lastCaptureAt } : {}),
      ...(parsed.lastCaptureSource === 'automatic' ||
      parsed.lastCaptureSource === 'manual' ||
      parsed.lastCaptureSource === 'taught'
        ? { lastCaptureSource: parsed.lastCaptureSource }
        : {}),
    };
  } catch {
    return { ...DEFAULT_LEARNING_POLICY };
  }
}

export function updateProjectAgentLearningPolicy(
  role: string,
  patch: Partial<Pick<ProjectAgentLearningPolicy, 'enabled'>>,
  projectRoot?: string,
): ProjectAgentLearningPolicy {
  const current = loadProjectAgentLearningPolicy(role, projectRoot);
  const updated = {
    ...current,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
  };
  writeTextAtomically(
    learningPolicyPath(role, projectRoot),
    `${JSON.stringify(updated, null, 2)}\n`,
  );
  return updated;
}

// ---------------------------------------------------------------------------
// Project agent config loading
// ---------------------------------------------------------------------------

/**
 * Load the project-level agent config for a given role.
 * Returns `undefined` when no project override exists.
 */
export function loadProjectAgentConfig(
  role: string,
  projectRoot?: string,
): ProjectAgentConfig | undefined {
  const cfgPath = path.join(roleDir(role, projectRoot), 'config.json');
  try {
    const raw = readFileSync(cfgPath, 'utf8');
    return validateProjectAgentConfig(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/**
 * Load the project-level identity appendix for a given role.
 * Appended to the subagent prompt after the base role prompt and policy.
 * Returns the empty string when no identity file exists.
 */
export function loadProjectAgentIdentity(role: string, projectRoot?: string): string {
  const identityPath = path.join(roleDir(role, projectRoot), 'identity.md');
  try {
    return readFileSync(identityPath, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Load the learning-derived wisdom for a given role.
 * Appended to the subagent prompt as a "knowledge from past sessions" block.
 * The learning file is auto-generated by the `memory-curator` or
 * `self-improving` agent roles and contains de-duplicated, curated findings.
 */
export function loadProjectAgentLearned(role: string, projectRoot?: string): string {
  const learnedPath = path.join(roleDir(role, projectRoot), 'learned.md');
  try {
    return readFileSync(learnedPath, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Load the current-knowledge checklist for a given role.
 * Returns the built-in directive if no project override exists.
 * The checklist guides the agent on what to verify from live registries
 * before answering questions in its domain.
 */
export function loadRoleKnowledgeManifest(
  role: string,
  projectRoot?: string,
): RoleKnowledgeManifest | undefined {
  // First look for project-level knowledge manifest
  const projectPath = path.join(roleDir(role, projectRoot), 'knowledge.json');
  try {
    const raw = readFileSync(projectPath, 'utf8');
    return JSON.parse(raw) as RoleKnowledgeManifest;
  } catch {
    // Fall back to built-in manifests
    return BUILT_IN_KNOWLEDGE_MANIFESTS[role];
  }
}

/**
 * Merge a project agent config onto a base `SubagentConfig`.
 * Returns a new config; does not mutate either input.
 */
export function applyProjectAgentConfig(
  base: SubagentConfig,
  projectConfig: ProjectAgentConfig | undefined,
  options: { protectSystemRole?: boolean | undefined } = {},
): SubagentConfig {
  if (!projectConfig) return base;
  const result: SubagentConfig = { ...base };
  if (projectConfig.tools !== undefined) {
    result.tools = options.protectSystemRole
      ? base.tools === undefined
        ? undefined
        : [...new Set([...base.tools, ...projectConfig.tools])]
      : [...projectConfig.tools];
  }
  if (projectConfig.skillNames !== undefined) result.skillNames = [...projectConfig.skillNames];
  if (projectConfig.provider !== undefined) result.provider = projectConfig.provider;
  if (projectConfig.model !== undefined) result.model = projectConfig.model;
  if (projectConfig.modelPolicy !== undefined) {
    result.modelPolicy = {
      allowed: projectConfig.modelPolicy.allowed.map((target) => ({ ...target })),
      fallbacks: projectConfig.modelPolicy.fallbacks?.map((target) => ({ ...target })),
      // System roles must remain recoverable even when a preferred model is
      // temporarily unavailable. Custom roles may opt into a hard boundary.
      strict: options.protectSystemRole ? false : (projectConfig.modelPolicy.strict ?? false),
    };
    result.fallbackModels = (projectConfig.modelPolicy.fallbacks ?? []).map(
      (target) => `${target.provider}/${target.model}`,
    );
  } else if (projectConfig.fallbackProfile !== undefined) {
    result.fallbackProfile = projectConfig.fallbackProfile;
  }
  if (projectConfig.cwd !== undefined) result.cwd = projectConfig.cwd;
  if (projectConfig.worktree !== undefined) {
    result.worktree =
      options.protectSystemRole &&
      (projectConfig.worktree === true || projectConfig.worktree === 'required')
        ? 'auto'
        : projectConfig.worktree;
  }
  if (projectConfig.availability !== undefined) {
    result.availability = {
      ...projectConfig.availability,
      days: [...projectConfig.availability.days],
      mode: options.protectSystemRole ? 'advisory' : (projectConfig.availability.mode ?? 'enforce'),
    };
  }
  if (projectConfig.allowedCapabilities !== undefined) {
    result.allowedCapabilities = options.protectSystemRole
      ? base.allowedCapabilities === undefined
        ? undefined
        : [...new Set([...base.allowedCapabilities, ...projectConfig.allowedCapabilities])]
      : [...projectConfig.allowedCapabilities];
  }
  if (projectConfig.budget) {
    if (projectConfig.budget.timeoutMs !== undefined)
      result.timeoutMs = projectConfig.budget.timeoutMs;
    if (projectConfig.budget.idleTimeoutMs !== undefined)
      result.idleTimeoutMs = projectConfig.budget.idleTimeoutMs;
    if (projectConfig.budget.maxIterations !== undefined)
      result.maxIterations = projectConfig.budget.maxIterations;
    if (projectConfig.budget.maxToolCalls !== undefined)
      result.maxToolCalls = projectConfig.budget.maxToolCalls;
    if (projectConfig.budget.maxTokens !== undefined)
      result.maxTokens = projectConfig.budget.maxTokens;
    if (projectConfig.budget.maxCostUsd !== undefined)
      result.maxCostUsd = projectConfig.budget.maxCostUsd;
  }
  if (options.protectSystemRole) applySystemAgentBudgetFloors(result);
  return result;
}

const SYSTEM_AGENT_BUDGET_FLOORS = {
  timeoutMs: 300_000,
  idleTimeoutMs: 120_000,
  maxIterations: 20,
  maxToolCalls: 40,
  maxTokens: 8_192,
  maxCostUsd: 0.25,
} as const;

function applySystemAgentBudgetFloors(config: SubagentConfig): void {
  const mutable = config as unknown as Record<string, unknown>;
  for (const [field, floor] of Object.entries(SYSTEM_AGENT_BUDGET_FLOORS)) {
    const value = mutable[field];
    if (typeof value === 'number' && value < floor) mutable[field] = floor;
  }
}

/**
 * Build the full project-contextualized prompt for a given role.
 *
 * Cascade, from start to end:
 *   1. Base role prompt from instruction files (agentPrompt(id))
 *   2. Technology policy (appended by agentPrompt)
 *   3. Project identity appendix (identity.md)
 *   4. Learned wisdom (learned.md)
 *   5. Live-knowledge checklist
 */
// ---------------------------------------------------------------------------
// Update / reset / improve API
// ---------------------------------------------------------------------------

/**
 * Write or update the learned wisdom file for a given role.
 * Appends to existing content when `mode` is 'append'; replaces when
 * it is 'replace'. Returns the full path written so callers can log it.
 */
export function updateProjectAgentLearned(
  role: string,
  content: string,
  projectRoot?: string,
  mode: 'append' | 'replace' = 'append',
): string {
  const dir = roleDir(role, projectRoot);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'learned.md');
  const existing = (() => {
    try {
      return readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  })();
  const newContent =
    mode === 'append' && existing
      ? `${existing.trimEnd()}\n\n---\n\n${content.trimStart()}`
      : content;
  writeTextAtomically(filePath, newContent);
  return filePath;
}

/**
 * Write or update the project identity file for a given role.
 * Replaces any existing identity.md with the new content.
 */
export function updateProjectAgentIdentity(
  role: string,
  content: string,
  projectRoot?: string,
): string {
  const dir = roleDir(role, projectRoot);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'identity.md');
  writeTextAtomically(filePath, content);
  return filePath;
}

/**
 * Write or update the config.json override for a given role.
 */
export function updateProjectAgentConfig(
  role: string,
  config: ProjectAgentConfig,
  projectRoot?: string,
): string {
  const validated = validateProjectAgentConfig(config);
  const dir = roleDir(role, projectRoot);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'config.json');
  writeTextAtomically(filePath, `${JSON.stringify(validated, null, 2)}\n`);
  return filePath;
}

/**
 * Write or update the knowledge manifest for a given role.
 */
export function updateProjectAgentKnowledge(
  role: string,
  manifest: RoleKnowledgeManifest,
  projectRoot?: string,
): string {
  const dir = roleDir(role, projectRoot);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'knowledge.json');
  writeTextAtomically(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return filePath;
}

/**
 * Reset all project-level customizations for a given role back to factory
 * defaults by removing its `.wrongstack/agents/<role>/` directory.
 * When `role` is omitted or `'*'`, resets all roles.
 * Returns a list of paths that were removed.
 */
export function resetProjectAgentIdentity(role?: string, projectRoot?: string): string[] {
  const removed: string[] = [];
  if (!role || role === '*') {
    // Remove the entire agents directory
    const dir = agentsDir(projectRoot);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
    return removed;
  }
  const dir = roleDir(role, projectRoot);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

/**
 * Improve (or refresh) the project-custom identity for a given role
 * by clearing the learned.md and identity.md and re-scaffolding empty
 * templates. This is the explicit "refresh" trigger a user can call
 * when they want the project agent to re-learn from scratch.
 *
 * Returns a status report string.
 */
export function refreshProjectAgentIdentity(role: string, projectRoot?: string): string {
  const dir = roleDir(role, projectRoot);
  mkdirSync(dir, { recursive: true });

  // Remove learned wisdom and identity, keep config.json and knowledge.json
  for (const file of ['learned.md', 'identity.md']) {
    const fp = path.join(dir, file);
    try {
      rmSync(fp, { force: true });
    } catch {
      // file didn't exist
    }
  }

  // Re-scaffold identifying headers so the role knows these are available
  writeTextAtomically(
    path.join(dir, 'learned.md'),
    `# Learned wisdom for ${role}\n\n<!-- Accumulated project-specific knowledge appears here after agent-improve runs. -->\n`,
  );
  writeTextAtomically(
    path.join(dir, 'identity.md'),
    `# Project identity for ${role}\n\n<!-- Describe how this agent should behave in the context of this project. -->\n`,
  );

  return `Project identity for role "${role}" has been refreshed. The identity.md and learned.md files are reset to empty templates. Run an agent-improve pass to populate them with project-specific knowledge.`;
}

export function buildProjectContextualizedPrompt(
  basePrompt: string,
  role: string,
  projectRoot?: string,
  options: { identityOverride?: string | undefined } = {},
): string {
  const contextStart = '<!-- wrongstack:project-agent-context:start -->';
  const contextEnd = '<!-- wrongstack:project-agent-context:end -->';

  // Skip project identity when WRONGSTACK_AGENT_INSTRUCTIONS_DIR is set
  // (this is a test/override context — keep byte-exact equality with on-disk files).
  // The marker cleanup below is intentionally placed AFTER this early return so a
  // prompt that already contains legacy context markers is preserved verbatim.
  if (process.env['WRONGSTACK_AGENT_INSTRUCTIONS_DIR']) return basePrompt;

  const cleanBase = basePrompt
    .replace(
      /\s*<!-- wrongstack:project-agent-context:start -->[\s\S]*?<!-- wrongstack:project-agent-context:end -->\s*/g,
      '\n',
    )
    .trim();
  const parts: string[] = [cleanBase];

  const identity = options.identityOverride ?? loadProjectAgentIdentity(role, projectRoot);
  if (identity) {
    parts.push(`\n\n# Project custom identity\n\n${identity}`);
  }

  const learningPolicy = loadProjectAgentLearningPolicy(role, projectRoot);
  const learned = learningPolicy.enabled ? loadProjectAgentLearned(role, projectRoot) : '';
  if (learned) {
    // Only include learned wisdom that has meaningful content (strip HTML comments)
    const meaningful = learned.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (meaningful.length > 0) {
      parts.push(`\n\n# Learned wisdom for this project\n\n${learned}`);
    }
  }

  // ── Capture mechanism: tell every agent HOW to persist new knowledge ──
  const effectiveProjectRoot = projectRoot || process.cwd();
  const learnedFilePath = path.join(
    effectiveProjectRoot,
    '.wrongstack',
    'agents',
    role,
    'learned.md',
  );
  if (learningPolicy.enabled) {
    parts.push(
      `\n\n## Knowledge capture\n\nWhen you discover a project-specific pattern, convention, or decision that future "${role}" invocations should remember, end your response with a \`## LEARNED\` block. The runtime persists that content to:\n\n  \`\`\`\n  ${learnedFilePath}\n  \`\`\`\n\nCapture only durable, cross-session knowledge — never ephemeral task details.`,
    );
  }

  const knowledge = loadRoleKnowledgeManifest(role, projectRoot);
  if (knowledge && knowledge.checklist.length > 0) {
    const checklist = knowledge.checklist.map((item) => `- ${item}`).join('\n');
    parts.push(
      `\n\n## Current knowledge requirements\n\nVerify these before answering:\n${checklist}`,
    );
  }

  const additions = parts.slice(1).join('\n\n').trim();
  if (!additions) return cleanBase;
  return `${cleanBase}\n\n${contextStart}\n${additions}\n${contextEnd}`;
}

// ---------------------------------------------------------------------------
// Learned-wisdom capture from agent output
// ---------------------------------------------------------------------------

// ─── learned.md automation contract ────────────────────────────────────────
//
//  TRIGGER  Primary: end of a delegated subagent task (CLI fleet host's
//           task.completed handler). The director's task resolution checks the
//           final output text for ## LEARNED blocks and captures durable entries.
//           Secondary: leader's own output after a user-invoked improvement
//           prompt ("improve the executor agent"). Never on intermediate tool
//           calls or every iteration — only once per task resolution.
//           Manual: `/agent-improve <role> capture` at any time.
//
//  GUARDRAILS
//
//  1. COOLDOWN  Per-role: minimum 120 seconds between captures. Tracks the
//     last capture timestamp in a module-level Map.  A capture within the
//     cooldown window is silently skipped (counter not bumped).
//
//  2. FREQUENCY CAP  Per-session: at most 3 captures per role before the
//     capture falls through to `/agent-improve` (human-gated). The session
//     is reset on process restart (module reload).
//
//  3. HUMAN-APPROVAL THRESHOLD  When `learned.md` exceeds `LEARNED_SOFT_LIMIT`
//     (8 KB) the next capture is deferred — the agent is asked to run
//     `/agent-improve <role> refresh` or the user must call it explicitly.
//     The hintLearnedNeedsSummarization() check is exposed so the CLI can
//     surface this in /agent-improve output.
//
//  4. SIZE  SOFT_LIMIT = 8 192 B → hintLearnedNeedsSummarization() returns true.
//           HARD_LIMIT = 16 384 B → `pruneToSize()` drops oldest entries.
//
//  5. CONTENT QUALITY  A block is skipped when:
//     - meaningful body (strip markdown) < 50 chars
//     - >70% of lines are code fences
//     - near-duplicate by Jaccard ≥ 0.55
//
//  OWNER  logic : packages/core/src/coordination/agents/project-agent-identity.ts
//         hook  : packages/cli/src/fleet/host.ts
// ---------------------------------------------------------------------------

export const LEARNED_SOFT_LIMIT = 8_192;
export const LEARNED_HARD_LIMIT = 16_384;

/**
 * Normalize text for dedup comparison: lowercase, strip punctuation, sort tokens.
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ');
}

// ─── Automation guardrails ───────────────────────────────────────────────────

const captureCooldowns = new Map<string, number>(); // role → timestamp
const captureFrequency = new Map<string, number>(); // role → count

export const CAPTURE_COOLDOWN_MS = 120_000; // 2 minutes
export const CAPTURE_MAX_PER_SESSION = 3;

/**
 * Check whether a new capture is allowed for this role. Returns a rejection
 * reason string when blocked, or undefined when capture may proceed.
 */
export function canCaptureNewLearned(
  role: string,
  existingSize: number,
  isManual: boolean,
  projectRoot?: string,
): string | undefined {
  const key = `${path.resolve(projectRoot ?? process.cwd())}\0${assertProjectAgentRole(role)}`;
  // Cooldown gate (bypassed for manual captures)
  if (!isManual) {
    const last = captureCooldowns.get(key);
    if (last && Date.now() - last < CAPTURE_COOLDOWN_MS) {
      return `Cooldown active for role "${role}" (${Math.ceil((CAPTURE_COOLDOWN_MS - (Date.now() - last)) / 1000)}s remaining)`;
    }
  }

  // Frequency cap (bypassed for manual captures)
  if (!isManual) {
    const count = captureFrequency.get(key) ?? 0;
    if (count >= CAPTURE_MAX_PER_SESSION) {
      return `Frequency cap reached for role "${role}" (${count}/${CAPTURE_MAX_PER_SESSION}). Use /agent-improve ${role} capture for manual override.`;
    }
  }

  // Size gate: when over SOFT_LIMIT, require manual approval
  if (existingSize > LEARNED_SOFT_LIMIT && !isManual) {
    return `learned.md for role "${role}" exceeds soft limit (${existingSize}B / ${LEARNED_SOFT_LIMIT}B). Run /agent-improve ${role} capture manually or /agent-improve ${role} refresh to reset.`;
  }

  return undefined;
}

/**
 * Per-role learning stats for monitoring UIs.
 */
export interface ProjectAgentLearnStats {
  role: string;
  exists: boolean;
  entryCount: number;
  totalBytes: number;
  lastCapture: string | null;
  lastCaptureTimestamp: number | null;
  cooldownRemainingMs: number;
  sessionCaptureCount: number;
  needsSummarization: boolean;
  learnedPath: string | null;
  identityPath: string | null;
  hasIdentity: boolean;
  hasConfig: boolean;
  hasKnowledge: boolean;
  learningEnabled: boolean;
  lifetimeCaptureCount: number;
  lastCaptureSource: ProjectAgentLearningPolicy['lastCaptureSource'] | null;
}

export function getProjectAgentLearnStats(
  role: string,
  projectRoot?: string,
): ProjectAgentLearnStats {
  const dir = roleDir(role, projectRoot);
  const learnedPath_ = path.join(dir, 'learned.md');
  const identityPath_ = path.join(dir, 'identity.md');
  const configPath_ = path.join(dir, 'config.json');
  const knowledgePath_ = path.join(dir, 'knowledge.json');
  let learnedText = '';
  try {
    learnedText = readFileSync(learnedPath_, 'utf8');
  } catch {
    /* no file */
  }
  const entries = splitLearnedEntries(learnedText);
  const exists = existsSync(dir);
  const policy = loadProjectAgentLearningPolicy(role, projectRoot);
  const captureKey = `${path.resolve(projectRoot ?? process.cwd())}\0${assertProjectAgentRole(role)}`;
  const runtimeLastTs = captureCooldowns.get(captureKey) ?? null;
  const persistedLastTs = policy.lastCaptureAt ? Date.parse(policy.lastCaptureAt) : Number.NaN;
  const lastTs = runtimeLastTs ?? (Number.isFinite(persistedLastTs) ? persistedLastTs : null);
  const cooldownRemaining = lastTs ? Math.max(0, CAPTURE_COOLDOWN_MS - (Date.now() - lastTs)) : 0;
  const freq = captureFrequency.get(captureKey) ?? 0;

  return {
    role,
    exists,
    entryCount: entries.length,
    totalBytes: Buffer.byteLength(learnedText, 'utf8'),
    lastCapture: lastTs ? new Date(lastTs).toISOString() : null,
    lastCaptureTimestamp: lastTs,
    cooldownRemainingMs: cooldownRemaining,
    sessionCaptureCount: freq,
    needsSummarization: exists
      ? hintLearnedNeedsSummarization(role, projectRoot).length > 0
      : false,
    learnedPath: existsSync(learnedPath_) ? learnedPath_ : null,
    identityPath: existsSync(identityPath_) ? identityPath_ : null,
    hasIdentity: existsSync(identityPath_),
    hasConfig: existsSync(configPath_),
    hasKnowledge: existsSync(knowledgePath_),
    learningEnabled: policy.enabled,
    lifetimeCaptureCount: policy.lifetimeCaptureCount,
    lastCaptureSource: policy.lastCaptureSource ?? null,
  };
}

/**
 * List every role that has any project-level agent customization or policy.
 */
export function listProjectAgentRoles(projectRoot?: string): string[] {
  const dir = agentsDir(projectRoot);
  try {
    return (readdirSync as (dir: string) => string[])(dir).filter((name: string) => {
      if (!AGENT_ROLE_PATTERN.test(name) || name === '.' || name === '..') return false;
      const sub = path.join(dir, name);
      try {
        return [
          'learned.md',
          'identity.md',
          'config.json',
          'knowledge.json',
          'learning.json',
          'profile.json',
        ].some((file) => existsSync(path.join(sub, file)));
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Re-export existsSync so callers can check file existence without importing fs.
 */
export { existsSync };

/**
 * Detect semantic conflicts between different roles' learned wisdom.
 * Returns entries where token overlap ≥ 0.60, which suggests the two
 * roles have learned about the same topic — potentially contradicting.
 */
export function detectLearnedConflicts(projectRoot?: string): Array<{
  roleA: string;
  roleB: string;
  snippetA: string;
  snippetB: string;
  similarity: number;
  detectedAt: string;
}> {
  const roles = listProjectAgentRoles(projectRoot);
  const entries: { role: string; normalized: string; raw: string }[] = [];
  for (const role of roles) {
    const text = loadProjectAgentLearned(role, projectRoot);
    if (!text || text.trim().length < 50) continue;
    entries.push({ role, normalized: normalizeForComparison(text), raw: text });
  }
  const conflicts: Array<{
    roleA: string;
    roleB: string;
    snippetA: string;
    snippetB: string;
    similarity: number;
    detectedAt: string;
  }> = [];
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!;
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]!;
      const sim = tokenOverlap(a.normalized, b.normalized);
      if (sim >= 0.6) {
        conflicts.push({
          roleA: a.role,
          roleB: b.role,
          snippetA: a.raw.slice(0, 200),
          snippetB: b.raw.slice(0, 200),
          similarity: sim,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }
  return conflicts.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Return the Jaccard similarity (0–1) of two normalised token sets.
 */
function tokenOverlap(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersect = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersect.size / union.size;
}

/**
 * Split an existing learned.md body into individual entries.
 * Entries are delimited by `---\n\n` sequences.
 */
function splitLearnedEntries(body: string): string[] {
  return body
    .split(/\n---\n+/)
    .map((entry) => entry.trim())
    .map((entry) =>
      entry
        .replace(/^# Learned wisdom for .+$/im, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim(),
    )
    .filter(Boolean);
}

export function listProjectAgentLearnedEntries(role: string, projectRoot?: string): string[] {
  return splitLearnedEntries(loadProjectAgentLearned(role, projectRoot));
}

/**
 * Remove entries from the learned body until it fits within `targetBytes`,
 * dropping the *oldest* entries first (entries are in chronological order
 * since new items are appended at the end).
 */
function pruneToSize(body: string, targetBytes: number): string {
  const entries = splitLearnedEntries(body);
  const result: string[] = [];
  let size = 0;
  // Iterate from newest (last) to oldest (first)
  for (let i = entries.length - 1; i >= 0; i--) {
    const current = entries[i]!;
    const entry = `\n\n---\n\n${current}`;
    const entryBytes = Buffer.byteLength(entry, 'utf8');
    if (size + entryBytes <= targetBytes) {
      result.unshift(current);
      size += entryBytes;
    }
  }
  return result.join('\n\n---\n\n');
}

/**
 * Learned-wisdom capture from agent output.
 *
 * Scans `output` for `## LEARNED` blocks and persists each unique,
 * quality-passing block to the role's `learned.md`.  Deduplication is
 * performed against the existing content; if the new block is a near-
 * duplicate (token overlap ≥ 0.55) it is silently skipped.
 *
 * When the resulting file would exceed `LEARNED_HARD_LIMIT` (16 KB)
 * the oldest entries are rotated out before writing.
 *
 * @returns the number of **new** items actually persisted (0 if none).
 */
export function captureLearnedFromAgentOutput(
  output: string,
  role: string,
  projectRoot?: string,
  isManual = false,
): number {
  return captureLearnedFromAgentOutputDetailed(output, role, projectRoot, isManual).captured;
}

export function captureLearnedFromAgentOutputDetailed(
  output: string,
  role: string,
  projectRoot?: string,
  isManual = false,
): LearnedCaptureResult {
  const normalizedRole = assertProjectAgentRole(role);
  if (!output.trim()) {
    return { role: normalizedRole, captured: 0, skipped: 0, status: 'empty_output' };
  }
  const policy = loadProjectAgentLearningPolicy(normalizedRole, projectRoot);
  if (!policy.enabled && !isManual) {
    return {
      role: normalizedRole,
      captured: 0,
      skipped: 0,
      status: 'disabled',
      reason: 'Automatic learning is disabled for this role.',
    };
  }

  const regex = /^##\s*LEARNED\s*$/gim;
  const candidates: string[] = [];
  let startMatch = regex.exec(output);
  while (startMatch !== null) {
    const blockStart = startMatch.index + startMatch[0].length;
    const rest = output.slice(blockStart);
    const nextHeading = /^##\s/gm.exec(rest);
    const blockEnd = nextHeading ? blockStart + nextHeading.index : output.length;
    candidates.push(output.slice(blockStart, blockEnd).trim());
    regex.lastIndex = Math.max(regex.lastIndex, blockEnd);
    startMatch = regex.exec(output);
  }
  if (candidates.length === 0) {
    return { role: normalizedRole, captured: 0, skipped: 0, status: 'no_blocks' };
  }

  const existingRaw = loadProjectAgentLearned(normalizedRole, projectRoot);
  const guard = canCaptureNewLearned(
    normalizedRole,
    Buffer.byteLength(existingRaw, 'utf8'),
    isManual,
    projectRoot,
  );
  if (guard) {
    return {
      role: normalizedRole,
      captured: 0,
      skipped: candidates.length,
      status: 'guarded',
      reason: guard,
    };
  }

  const normalizedEntries = listProjectAgentLearnedEntries(normalizedRole, projectRoot)
    .map((entry) => entry.replace(/^> (?:Captured|Taught) .+$/m, '').trim())
    .filter(Boolean)
    .map(normalizeForComparison);
  let newContent = existingRaw;
  let captured = 0;
  let skipped = 0;
  const now = new Date();
  const remainingSessionCaptures = isManual
    ? Number.POSITIVE_INFINITY
    : Math.max(
        0,
        CAPTURE_MAX_PER_SESSION -
          (captureFrequency.get(
            `${path.resolve(projectRoot ?? process.cwd())}\0${normalizedRole}`,
          ) ?? 0),
      );

  for (const content of candidates) {
    if (captured >= remainingSessionCaptures) {
      skipped++;
      continue;
    }
    const meaningful = content
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[#*_>`-]/g, ' ')
      .trim();
    if (meaningful.length < 50) {
      skipped++;
      continue;
    }
    const totalLines = Math.max(1, content.split('\n').length);
    const codeBodyLines = (content.match(/```[\s\S]*?```/g) ?? []).reduce(
      (sum, block) => sum + Math.max(0, block.split('\n').length - 2),
      0,
    );
    if (totalLines > 5 && codeBodyLines / totalLines > 0.7) {
      skipped++;
      continue;
    }
    const candidateNorm = normalizeForComparison(content);
    if (normalizedEntries.some((entry) => tokenOverlap(candidateNorm, entry) >= 0.55)) {
      skipped++;
      continue;
    }
    normalizedEntries.push(candidateNorm);
    const stamped = `> Captured ${now.toISOString()}\n\n${content}`;
    newContent = newContent ? `${newContent}\n\n---\n\n${stamped}` : stamped;
    captured++;
  }

  if (captured === 0) {
    return {
      role: normalizedRole,
      captured: 0,
      skipped,
      status: 'quality_rejected',
      reason: 'Every LEARNED block was too short, code-only, or a near-duplicate.',
    };
  }
  if (Buffer.byteLength(newContent, 'utf8') >= LEARNED_HARD_LIMIT) {
    newContent = pruneToSize(newContent, LEARNED_SOFT_LIMIT);
  }

  writeTextAtomically(path.join(roleDir(normalizedRole, projectRoot), 'learned.md'), newContent);
  const captureKey = `${path.resolve(projectRoot ?? process.cwd())}\0${normalizedRole}`;
  captureCooldowns.set(captureKey, now.getTime());
  // Increment the frequency counter by 1 per capture attempt (not by
  // `captured`, the number of LEARNED blocks appended). Otherwise a single
  // response that yields N blocks immediately exhausts the
  // CAPTURE_MAX_PER_SESSION budget for the rest of the session, while a
  // response that yields 0 blocks consumes nothing — both diverge from the
  // documented "attempts per session" semantics the cap is meant to enforce.
  captureFrequency.set(captureKey, (captureFrequency.get(captureKey) ?? 0) + 1);
  const nextPolicy: ProjectAgentLearningPolicy = {
    ...policy,
    lifetimeCaptureCount: policy.lifetimeCaptureCount + captured,
    lastCaptureAt: now.toISOString(),
    lastCaptureSource: isManual ? 'manual' : 'automatic',
  };
  writeTextAtomically(
    learningPolicyPath(normalizedRole, projectRoot),
    `${JSON.stringify(nextPolicy, null, 2)}\n`,
  );
  return { role: normalizedRole, captured, skipped, status: 'captured' };
}

/**
 * Signal the host that a background summarisation pass is warranted.
 * Called by `captureLearnedFromAgentOutput` when the **new** learned size
 * crosses `LEARNED_SOFT_LIMIT`.  The host is responsible for scheduling a
 * low-priority consolidation task (typically via the Brain or a shadow agent).
 *
 * The summary _mechanism_ is intentionally shallow here — the real
 * summarisation is an LLM call that should run as a deferred, uncritical
 * fleet task so it never blocks a user-facing operation.
 *
 * @returns a summary brief for the host, or '' when no action is needed.
 */
export function hintLearnedNeedsSummarization(role: string, projectRoot?: string): string {
  const learned = loadProjectAgentLearned(role, projectRoot);
  if (!learned) return '';
  const bytes = Buffer.byteLength(learned, 'utf8');
  if (bytes < LEARNED_SOFT_LIMIT) return '';
  return `Learned wisdom for role "${role}" is ${bytes} B (soft limit ${LEARNED_SOFT_LIMIT}). Schedule a low-priority consolidation pass.`;
}

// ---------------------------------------------------------------------------
// Built-in knowledge manifests (per role type, current-needs checklist)
// ---------------------------------------------------------------------------

const BUILT_IN_KNOWLEDGE_MANIFESTS: Record<string, RoleKnowledgeManifest> = {
  android: {
    role: 'android',
    liveQueries: {
      agp: {
        registry: 'https://developer.android.com/build/releases/gradle-plugin',
        key: 'latest',
        description: 'Android Gradle Plugin latest stable',
      },
      kotlin: {
        registry: 'https://registry.npmjs.org/kotlin/latest',
        key: 'version',
        description: 'Kotlin latest stable',
      },
      compileSdk: {
        registry: 'https://developer.android.com/about/versions',
        key: 'api_level',
        description: 'Current stable API level',
      },
    },
    checklist: [
      'Current Android Gradle Plugin version (8.x+)',
      'Current Kotlin version (2.x+)',
      'Current compileSdk / targetSdk (≥ 34, check Play Store policy)',
      'Current Jetpack Compose stable version',
      'All third-party dependencies are at latest compatible minor',
    ],
    verifyThreshold: 0.5,
  },
  frontend: {
    role: 'frontend',
    liveQueries: {
      react: {
        registry: 'https://registry.npmjs.org/react/latest',
        key: 'version',
        description: 'React latest stable',
      },
      nextjs: {
        registry: 'https://registry.npmjs.org/next/latest',
        key: 'version',
        description: 'Next.js latest stable',
      },
    },
    checklist: [
      'Current React version (pinned in package.json)',
      'Current Next.js / Vite / framework version',
      'Node.js runtime version (project .nvmrc or engines)',
      'All devDependencies are at latest compatible versions',
      'Browser compatibility targets from browserslist',
    ],
    verifyThreshold: 0.5,
  },
  executor: {
    role: 'executor',
    liveQueries: {
      node: {
        registry: 'https://registry.npmjs.org/node/latest',
        key: 'version',
        description: 'Node.js latest LTS',
      },
    },
    checklist: [
      'Node.js version from .nvmrc or package.engines',
      'TypeScript version from package.json',
      'Package manager (pnpm ≥ 9) from packageManager',
      'Current toolchain: esbuild, vitest, etc.',
    ],
    verifyThreshold: 0.6,
  },
};
