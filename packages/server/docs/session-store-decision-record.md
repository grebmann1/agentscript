# Session Store Decision Record

## Decision

Adopt `SessionService` + `SessionStore` interface with:

- Default: `InMemorySessionStore`
- Production option: `PostgresSessionStore`

## Why

- Keeps default local developer experience simple.
- Provides path to durable records and multi-dyno-friendly metadata persistence.
- Preserves pluggability for Redis/other backends later.

## Tradeoffs

- Runtime agent instances remain process-local.
- Persisted session records do not yet guarantee full turn continuation across process boundaries.
- Cross-dyno live handoff requires checkpoint serialization/rehydration (future milestone).

## Revisit triggers

- Need >1 dyno active-active with strict session continuity.
- Need regional failover with warm-state restoration.
- Need strict recovery guarantees after deploy/restart.
