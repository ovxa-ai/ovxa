# OVXA

**The UI Intelligence Engine for Generative UI.**

A model proposes an interface. The compiler decides what survives.

This repository is the embeddable engine — schema, registry, Quality Engine,
compiler, protocol, runtime, and React renderer. The hosted control plane that
runs [ovxa.ai](https://ovxa.ai) lives in [`ovxa-ai/studio`](https://github.com/ovxa-ai/studio).

```text
Intent
  → Context understanding
  → Competing UI plans
  → Quality Engine evaluation
  → Best plan
  → Compile + render
  → Interaction
  → Outcome
  → Next decision
```

The north star is not “did the UI render.” It is: did the generated interface
help the user finish the task?

## Packages

Dependency flow is one way. Nothing below imports anything above.

| Package | Role |
| --- | --- |
| `@ovxa/schema` | Declarative surface, bindings, actions, patches |
| `@ovxa/registry` | Component and action allowlist |
| `@ovxa/intelligence` | Understand, propose, score, select, learn |
| `@ovxa/compiler` | Plan → generate → ground → fallback |
| `@ovxa/llm` | Provider-independent model adapters |
| `@ovxa/surface-model` | Hosted generation against a narrowed catalogue |
| `@ovxa/protocol` | Ordered streaming events and reducer |
| `@ovxa/streaming` | Incremental parse + compile + emit |
| `@ovxa/genui-runtime` | Bindings, actions, optimistic updates |
| `@ovxa/react` | Renderer and provider |
| `@ovxa/client` | Typed HTTP / SSE client |
| `@ovxa/surface-kit` | Reference component definitions |
| `@ovxa/wire` | Compact prompt encoding |

Unregistered components never render. Invalid generations become a simpler
surface, never a blank screen, never arbitrary code.

## Install

```bash
npm install @ovxa/client @ovxa/react
```

```tsx
import { createOvxa } from "@ovxa/client";
import { OVXAProvider, OVXASurface } from "@ovxa/react";

const ovxa = createOvxa({ baseUrl: "/api" });

<OVXAProvider client={ovxa} components={components} actions={actions}>
  <OVXASurface intent={intent} state={data} />
</OVXAProvider>
```

Until packages are published to npm, consume this repo from
[`ovxa-ai/studio`](https://github.com/ovxa-ai/studio) as the `engine` git
submodule, or clone it as a workspace sibling.

## Develop

```bash
npm install
npm test
npm run typecheck
```

Node.js 22 or newer.

## License

Apache-2.0
