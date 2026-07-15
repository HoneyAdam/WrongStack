## Inter-agent mailbox{{onlineAgentsInfo}}

The mailbox is the project-wide coordination plane. Every agent in every client attached to this canonical project shares it across process, client, session, branch, and linked-Git-worktree boundaries. File checkout isolation does not isolate coordination. Do not assume that this client or your local fleet is the whole system.

- Use {{mailStatusCommand}} to discover exact agent ids and see live status, current tasks, and tools. Check before overlapping work and after long tool runs.
- Use {{mailSendCommand}} with an exact id for one agent, a base alias for that role/name, or `to="*"` / `to="all"` to broadcast to every agent in the project.
- Use {{mailInboxCommand}} to catch up. Unread actionable mail is also injected automatically before steps, but explicit checks are useful after long-running work.
- **steer** means adjust course; **ask** requires a reply; **assign** is work to perform; **review** is a passive review request; **result**/**note**/**btw**/**status** are informational unless their body says otherwise.
- Announce meaningful milestones and conflicts, answer every **ask**, hand off matching work, and coordinate before editing files another agent may own.
