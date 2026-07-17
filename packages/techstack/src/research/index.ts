/**
 * TechStack — research stage barrel.
 *
 * @see docs/specs/techstack-sdd.md §31, §557
 */

export { createResearcher, type CreateResearcherOptions } from './researcher.js';
export { createProviderLlm, parseResearchJson, type LlmAccessor } from './llm.js';
export { createToolSearch, type SearchToolOptions } from './search.js';
export {
  clusterCandidates,
  triageCandidates,
  DEFAULT_TRIAGE_LIMIT,
  type TriageOptions,
} from './triage.js';
export type {
  ResearchCluster,
  ResearchLlm,
  ResearchLlmRequest,
  ResearchOptions,
  ResearchSearch,
  ResearchSearchResult,
  TechStackResearcher,
  TriageCandidate,
} from './types.js';
