# OVXA

**The UI Intelligence Engine for Generative UI.**

A model proposes an interface. The compiler decides what survives.

```tsx
import { Ovxa } from "@ovxa/sdk";
import "@ovxa/sdk/styles.css";

<Ovxa intent="Compare Q2 revenue against Q1" data={revenue} />
```

That is the customer integration. Streaming, reconciliation, the action loop,
and loading / empty / error states are handled by the SDK.

This repository is the embeddable engine — schema, registry, Quality Engine,
compiler, protocol, runtime, renderer, and SDK. The hosted control plane that
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

## Install

```bash
npm install @ovxa/sdk
```

```tsx
import { Ovxa } from "@ovxa/sdk";
import "@ovxa/sdk/styles.css";

export function RevenueReview({ revenue }) {
  return (
    <Ovxa
      intent="Compare Q2 revenue against Q1 and show where growth was lost"
      data={revenue}
    />
  );
}
```

Server-side, never ship a provider key to the browser:

```ts
import { createOvxa } from "@ovxa/sdk";

const ovxa = createOvxa({
  apiKey: process.env.OVXA_API_KEY,
  baseUrl: "https://ovxa.ai/api",
});

const { surface } = await ovxa.generate({ intent, state: data });
```

Until packages are published to npm, consume this repo from
[`ovxa-ai/studio`](https://github.com/ovxa-ai/studio) as the `engine` git
submodule, or clone it as a workspace sibling.

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
| `@ovxa/sdk` | Zero-config customer SDK |
| `@ovxa/surface-kit` | Reference component definitions |
| `@ovxa/wire` | Compact prompt encoding |

Unregistered components never execute code. Invalid generations become a simpler
surface, never a blank screen, never arbitrary code. A missing renderer still
shows the data.

## Develop

```bash
npm install
npm test
npm run typecheck
```

Node.js 22 or newer. CI runs on every pull request. A version tag `v*` publishes
public packages to npm with provenance.

## License

Apache-2.0
