import { AGENTS_BY_PHASE } from '@wrongstack/core/agent-catalog';

export interface ModelMatrixRouteRole {
  role: string;
  name: string;
}

export interface ModelMatrixRouteGroup {
  phase: string;
  label: string;
  roles: readonly ModelMatrixRouteRole[];
}

export const MODEL_MATRIX_DEFAULT_ROUTE = '*';

export const MODEL_MATRIX_ROUTE_GROUPS: readonly ModelMatrixRouteGroup[] = Object.entries(
  AGENTS_BY_PHASE,
).map(([phase, definitions]) => ({
  phase,
  label: `${phase.charAt(0).toUpperCase()}${phase.slice(1)}`,
  roles: definitions.flatMap((definition) => {
    const role = definition.config.role;
    return role ? [{ role, name: definition.config.name }] : [];
  }),
}));

export const MODEL_MATRIX_PHASE_ROUTES = MODEL_MATRIX_ROUTE_GROUPS.map((group) => group.phase);

export const MODEL_MATRIX_ROUTE_ROLES: readonly ModelMatrixRouteRole[] =
  MODEL_MATRIX_ROUTE_GROUPS.flatMap((group) => [...group.roles]);

export const MODEL_MATRIX_ROLE_ROUTES = MODEL_MATRIX_ROUTE_ROLES.map((role) => role.role);

export const MODEL_MATRIX_KNOWN_ROUTES = [
  MODEL_MATRIX_DEFAULT_ROUTE,
  ...MODEL_MATRIX_PHASE_ROUTES,
  ...MODEL_MATRIX_ROLE_ROUTES,
];

export function formatModelMatrixRouteLabel(route: string): string {
  if (route === MODEL_MATRIX_DEFAULT_ROUTE) return 'Default (*)';
  const phase = MODEL_MATRIX_ROUTE_GROUPS.find((group) => group.phase === route);
  if (phase) return `Phase: ${phase.label} (${phase.phase})`;
  const role = MODEL_MATRIX_ROUTE_ROLES.find((candidate) => candidate.role === route);
  return role ? `${role.name} (${role.role})` : `Custom: ${route}`;
}
