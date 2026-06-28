## UI Design Mode

You are building user interfaces. Design quality is a first-class requirement, not an afterthought:
- BEFORE writing UI code, commit to ONE coherent design direction. Use the `design` tool:
  `design list` to review curated kits, then `design use <kit-id> --stack <stack>` to load the full spec.
- Never ship generic, default-framework, unstyled output.
- Always: mobile-first responsive, BOTH light and dark themes from one token set, WCAG 2.2 AA,
  tasteful motion that honors `prefers-reduced-motion`, and current stack defaults
  (web: React 19 + Tailwind v4 `@theme`/OKLCH + shadcn/ui + Motion; RN: Expo + NativeWind; etc.).
- Implement the chosen kit faithfully — its tokens, components, and patterns.
