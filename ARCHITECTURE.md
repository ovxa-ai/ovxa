# Architecture

This repository is the **engine**. It has no HTTP server, no database, and no
product graph. Those belong in [`ovxa-ai/studio`](https://github.com/ovxa-ai/studio).

## Boundaries

```text
schema
  → registry
      → intelligence
          → compiler ──→ surface-model ──→ llm
              → protocol
                  → streaming
                  → genui-runtime
                      → react
                      → client
```

- **Types at package exports.** Locals stay inferred.
- **Discriminated unions for state.** No boolean flag pairs.
- **Zero `any`.** Refine `unknown` at the edge.
- **Fail closed.** A node that cannot resolve to a registered component is
  stripped. A model that cannot produce a valid surface yields a compiler
  fallback.

## What does not live here

| Concern | Home |
| --- | --- |
| Fastify API, auth, Cloud SQL | `ovxa-ai/studio` |
| Living Product Graph, observer SDK | `ovxa-ai/studio` |
| Experience runtime / planner / policy | `ovxa-ai/studio` |
| Cloud Run, Terraform, Cloudflare | `ovxa-ai/studio` |

`@ovxa/llm` is the provider adapter only. Experience-generation types stay in
studio’s `@ovxa/llm-gateway`, which re-exports this package.

## Testing

Every package that can break a guarantee has a suite next to the source:

- schema validation and malformed bindings
- registry allowlisting
- Quality Engine ranking, including chat and static baselines
- compiler grounding and fallback
- stream reorder / duplicate / interrupt
- runtime optimistic rollback
- LLM config without credentials stays deterministic
