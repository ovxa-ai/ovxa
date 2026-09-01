# OVXA

[![CI](https://github.com/ovxa-ai/ovxa/actions/workflows/ci.yml/badge.svg)](https://github.com/ovxa-ai/ovxa/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

The UI Intelligence Engine for Generative UI.

A model proposes an interface. The compiler decides what survives. The north
star is not whether the UI rendered — it is whether the generated interface
helped the user finish the task.

```tsx
import { Ovxa } from "@ovxa/sdk";
import "@ovxa/sdk/styles.css";

<Ovxa intent="Compare Q2 revenue against Q1" data={revenue} />
```

That is the integration. Streaming, reconciliation, the action loop, and
loading / empty / error states are handled by the SDK.

The hosted control plane at [ovxa.ai](https://ovxa.ai) lives in
[`ovxa-ai/studio`](https://github.com/ovxa-ai/studio).

## Install

```bash
npm install @ovxa/sdk
```

```tsx
import { Ovxa } from "@ovxa/sdk";
import "@ovxa/sdk/styles.css";

export function RevenueReview({ revenue }: { revenue: Record<string, unknown> }) {
  return (
    <Ovxa
      intent="Compare Q2 revenue against Q1 and show where growth was lost"
      data={revenue}
    />
  );
}
```

Never ship a server key to a browser. On the backend:

```ts
import { createOvxa } from "@ovxa/sdk";

const ovxa = createOvxa({
  apiKey: process.env.OVXA_API_KEY,
  baseUrl: "https://ovxa.ai/api",
});

const { surface } = await ovxa.generate({ intent, state: data });
```

Until packages are on npm, consume this repo from studio as the `engine`
submodule, or clone it as a workspace sibling.

## How generation works

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

Unregistered components never execute code. Invalid generations become a simpler
surface, never a blank screen. A missing renderer still shows the data.

## Packages

Dependency flow is one way. Nothing below imports anything above.

| Package | Role |
| --- | --- |
| `@ovxa/sdk` | Zero-config customer SDK |
| `@ovxa/client` | Typed HTTP / SSE transport |
| `@ovxa/react` | Renderer and provider |
| `@ovxa/schema` | Surface, bindings, actions, patches |
| `@ovxa/registry` | Component and action allowlist |
| `@ovxa/intelligence` | Understand, propose, score, select |
| `@ovxa/compiler` | Plan → generate → ground → fallback |
| `@ovxa/protocol` | Ordered streaming events |
| `@ovxa/streaming` | Incremental parse + compile |
| `@ovxa/genui-runtime` | Bindings, optimistic updates |
| `@ovxa/surface-kit` | Reference component definitions |
| `@ovxa/surface-model` | Hosted generation against a catalogue |
| `@ovxa/llm` | Provider adapters |
| `@ovxa/wire` | Compact prompt encoding |

## Develop

Requires Node.js 22 or newer.

```bash
npm install
npm test
npm run typecheck
```

CI runs on every pull request. A version tag `v*` publishes public packages to
npm with provenance. See [RELEASE.md](RELEASE.md) and [SECURITY.md](SECURITY.md).

## License

Apache-2.0
