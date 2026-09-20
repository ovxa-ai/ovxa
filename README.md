<p align="center">
  <img src="packages/site/public/logo.svg" width="56" height="56" alt="OVXA" />
</p>

<h1 align="center">OVXA</h1>

<p align="center">
  <a href="https://github.com/ovxa-ai/ovxa/actions/workflows/ci.yml"><img src="https://github.com/ovxa-ai/ovxa/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
</p>

<p align="center">The UI Intelligence Engine for Generative UI.</p>

A model proposes an interface. The compiler decides what survives. The north
star is not whether the UI rendered — it is whether the generated interface
helped the user finish the task.

```tsx
import { Ovxa, OvxaSearch } from "@ovxa/sdk";
import "@ovxa/sdk/styles.css";

<Ovxa intent="Compare Q2 revenue against Q1" data={revenue} />
<OvxaSearch data={workspace} />
```

That is the integration. `Ovxa` renders one intent. `OvxaSearch` lets the user
type theirs — a search box for interfaces — and renders the answer underneath.
Streaming, reconciliation, the action loop, and loading / empty / error states
are handled by the SDK.

The landing page is [`@ovxa/site`](packages/site): static files plus a Node
handler that serves them, so the studio server at [ovxa.ai](https://ovxa.ai)
mounts it straight from the engine. The hosted control plane itself lives in
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

The surface inherits your `color` and `font`; everything else is a token. Match
a design system with `theme` or `--ovxa-*` custom properties, and pass
`components` to render with your own. See the
[SDK README](packages/sdk/README.md).

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
submodule, or clone it as a workspace sibling. Every package ships built ESM
and type declarations from `dist/`; `npm install` in a workspace that includes
`engine/packages/*` builds them, so no extra step is needed there. See
[Consuming from studio](#consuming-from-studio).

## Use cases

When chat is the wrong output: the user needs to **compare**, **choose**,
**configure**, **approve**, **investigate** or **monitor** something, and a
paragraph cannot do that. These ship as `defaultUseCases` and are the
suggestions `OvxaSearch` shows before the user types.

| | Intent | The interface that tends to win |
| --- | --- | --- |
| Compare | "Compare Q2 revenue against Q1 and show where growth was lost" | Two periods side by side, with the delta that explains the change |
| Choose | "Help me pick the right plan for a team of twelve" | Options with a recommendation |
| Configure | "Set alerting thresholds for the checkout service" | Only the fields that matter, prefilled |
| Approve | "Review this refund request and decide" | The facts, the risk, one clear action |
| Investigate | "Why did checkout conversion drop last Tuesday?" | A funnel, the anomaly, the sources |
| Monitor | "Show the health of the payments pipeline right now" | Live metrics, failing step first |

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
| `@ovxa/sdk` | Zero-config embed (`Ovxa`) and search (`OvxaSearch`) |
| `@ovxa/client` | Typed HTTP / SSE transport |
| `@ovxa/react` | Renderer, provider, theme tokens |
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
| `@ovxa/wire` | Compact prompt encoding, token benchmark |
| `@ovxa/site` | The ovxa.ai landing page and a handler that serves it |

## Develop

Requires Node.js 22 or newer.

```bash
npm install          # also builds every package to dist/
npm test
npm run typecheck
npm run build        # rebuild dist/ after editing a package
npm run dev          # rebuild on change
npm run check:dist   # load every package from dist the way npm consumers do
```

Tests and `typecheck` run against `src/` directly, so they never need a build.
Package `exports` point at `dist/`, which is what npm consumers and the studio
resolve; `npm run build` (or `npm run dev` while working) keeps it current.

Preview the landing page with any static server, e.g.
`python3 -m http.server -d packages/site/public 4173`.

CI runs on every pull request. A version tag `v*` publishes public packages to
npm with provenance; a push to `main` that touches `packages/site/public/`
deploys the landing page to GitHub Pages. See [RELEASE.md](RELEASE.md) and [SECURITY.md](SECURITY.md).

### Consuming from studio

Studio includes this repository as the `engine` git submodule and lists
`engine/packages/*` in its npm workspaces. Each engine package builds itself on
`prepare`, so studio's `npm install` produces `dist/` for all fourteen packages
and `@ovxa/*` imports resolve with no further configuration. After editing
engine source inside studio, run `npm run build` (or `npm run dev`) in the
`engine/` directory to refresh `dist/`.

The landing page reaches production the same way: studio registers
[`@ovxa/site`](packages/site/README.md) on its Fastify server and every
submodule bump ships the current page with the next studio deploy.

## License

Apache-2.0
