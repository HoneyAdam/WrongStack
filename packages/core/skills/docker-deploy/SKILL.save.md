# Docker Deploy — WrongStack (Compact)

Containerizes and deploys WrongStack with Docker.

## Rules

1. Multi-stage build: build stage + runtime stage (production deps only).
2. Use `node:*` base image with pinned version — not `node:latest`.
3. Never run as root in the container — use a non-root user.
4. Pass secrets via environment variables, not baked into the image.
5. Tag images with git SHA: `wrongstack:$GIT_SHA`.
6. Scan images for vulnerabilities: `trivy image` or `docker scout` before push.
7. Use `.dockerignore` to exclude `node_modules`, `dist`, `.git`, `*.test.ts`.

## Key best practices

| Practice | Why |
|----------|-----|
| Pin base image version | Reproducibility |
| Multi-stage build | 1GB → ~150MB |
| Non-root user | Security: container compromise ≠ host root |
| `.dockerignore` | Smaller image, faster builds |
| No `latest` tag | You always know which SHA |