# PharmacyOS Engineering Guide

## Source of truth

- Use `docs/DEVELOPMENT_PLAN.md` for sequencing, severity, and exit gates.
- Do not start a roadmap phase until the preceding phase's exit gate has objective evidence.
- Treat older completion plans as historical context when they conflict with the active plan.

## Required workflow

- Use Node.js 22 or newer and npm 10.9 or newer.
- Install with `npm ci`; do not hand-edit `package-lock.json`.
- Run `npm run verify` before handing off a change.
- Add or update tests for behavior changes. A file existing is not proof that a gate passed.
- Record actual commands, exit codes, limitations, and follow-up work in the relevant execution document.
- Keep commits scoped. Never commit `.env`, generated output, dependency caches, or credentials.

## Architecture invariants

- Money and quantities must use exact decimal or integer representations; never use floating point.
- Branch and terminal ownership must be explicit at every transactional boundary.
- Stock, cash, and future customer-credit ledgers are append-only audit records.
- Idempotent write paths must lock before replay checks and must reuse the same client request ID on retry.
- Database constraints and transaction boundaries enforce invariants; controllers validate input and services coordinate use cases.
- Preserve deterministic lock ordering for inventory rows.
- Migrations are immutable after application and must pass checksum verification.
- Internet-dependent integrations must not block LAN sales.

## Repository layout

- `apps/api`: NestJS/Fastify application and domain services.
- `apps/web`: React counter and operations client.
- `apps/worker`: durable background-job processor.
- `packages/config`: validated runtime configuration.
- `packages/database`: PostgreSQL access, migrations, and seeds.
- `packages/shared`: exact arithmetic and shared domain contracts.
- `infra`: deployment and operational scripts.
- `docs`: active plan, decisions, runbooks, and execution evidence.

## Quality and security

- Do not weaken lint, type, test, or build gates to make a change pass.
- Pin production-path dependencies exactly.
- Prefer the smallest compatible dependency set; document version constraints.
- Rotate local secrets with `npm run secrets:rotate-local`; never print their values.
- Preserve user work and keep unrelated changes out of a task.
