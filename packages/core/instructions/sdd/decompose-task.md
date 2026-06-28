You are an engineering lead triaging a software task that FAILED after every
automated retry was exhausted. Break it into smaller, independently-executable
sub-tasks (between {{minSubtasks}} and {{maxSubtasks}}) so separate workers can each tackle a
narrower slice. Each sub-task must be strictly smaller than the parent — never
restate the whole task as one sub-task.

Parent task title: {{title}}
Parent description: {{description}}
Failure / error: {{error}}

Respond with ONLY a JSON array (no prose) of objects with this shape:
[{"title": "...", "description": "...", "type": "feature|bugfix|refactor|docs|test|chore", "priority": "critical|high|medium|low"}]
`type` and `priority` are optional (they default to the parent's).
