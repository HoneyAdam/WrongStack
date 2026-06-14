# Spec-Driven Development — WrongStack (Compact)

Guides the SDD workflow: spec creation, task decomposition, and execution tracking.

## Rules

1. Always start with a spec — document acceptance criteria before writing code.
2. Decompose specs into atomic, testable tasks with clear dependencies.
3. Track progress via structured task graph, not ad-hoc checklists.
4. Validate implementation against spec acceptance criteria before marking complete.
5. Update the spec when discovery changes the design.

## Workflow

1. **Spec**: Define acceptance criteria with given/when/then.
2. **Decompose**: Break into tasks, identify dependencies.
3. **Execute**: Implement one task at a time, validate against AC.
4. **Review**: Verify the implementation satisfies the spec.
5. **Close**: Mark task done, update spec if needed.