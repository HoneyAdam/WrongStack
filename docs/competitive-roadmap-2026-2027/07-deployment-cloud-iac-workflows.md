# Deployment, Cloud, and IaC Workflows

**Priority:** P1  
**Horizon:** 4–9 months  
**Status:** Proposed

## Outcome

Give agents structured plan, validation, and deployment workflows for Docker, Kubernetes, Terraform/OpenTofu, and selected cloud CLIs while keeping provider-specific integrations outside the kernel.

## Product principle

WrongStack should expose a portable deployment workflow rather than dozens of loosely governed `deploy_*` commands. Vendor depth should come from plugins and MCP servers that implement the shared contract.

## Scope

- Detect deployment manifests and target environments.
- Validate and lint Dockerfiles, Compose, Kubernetes, and Terraform/OpenTofu.
- Produce plan/diff output before mutation.
- Execute approved applies/deployments with streamed logs and rollback metadata.
- Capture environment, revision, initiator, approval, and result in the audit trail.

## Delivery plan

1. Add read-only discovery, validation, and plan normalization.
2. Add local/container deployment workflows.
3. Add plugin contracts for Kubernetes, Terraform/OpenTofu, and cloud CLIs.
4. Add environment policies, protected targets, and rollback hooks.
5. Add HQ deployment visibility after the event contract is stable.

## Acceptance criteria

- Apply/deploy cannot run without a fresh, reviewable plan unless policy explicitly permits it.
- Production targets have a distinct capability and visible confirmation context.
- Credentials are resolved at execution time and never persisted in task results.
- Abort stops the client operation and records an indeterminate state when remote cancellation cannot be guaranteed.

