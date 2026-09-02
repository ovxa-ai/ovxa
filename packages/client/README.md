# @ovxa/client

Typed HTTP / SSE transport for OVXA. For the product integration, use
[`@ovxa/sdk`](../sdk/README.md):

```tsx
import { Ovxa } from "@ovxa/sdk";
import "@ovxa/sdk/styles.css";

<Ovxa intent="Compare Q2 revenue against Q1" data={revenue} />
```

Use this package when you are not rendering React, or when you already own the
stream.

```bash
npm install @ovxa/sdk
# transport only
npm install @ovxa/client
```

## Quickstart

This package is the transport, not the server implementation. Point it at the
OVXA API hosted by Studio, or at your own compatible same-origin route. Provider
credentials must remain on that server.

For React, use the one-component integration from `@ovxa/sdk`:

```tsx
import { Ovxa } from "@ovxa/sdk";
import "@ovxa/sdk/styles.css";

<Ovxa intent="Compare Q2 revenue against Q1" data={data} />
```

`createOvxa` remains the transport if you fold the stream yourself.

## The three ways to call it

```ts
// Whole surface, one await.
const { surface, plan, intelligence } = await ovxa.generate({ intent, state });

// Progressively — render while the model is still writing.
for await (const event of ovxa.stream({ intent, state })) { /* apply */ }

// Data you already computed. One model call, not two: you did the computing,
// the model only decides how it should be read.
const { surface } = await ovxa.visualize({ intent: "Explain monthly revenue", data });
```

Interactions patch the surface in place rather than regenerating it:

```ts
const { surface, revision } = await ovxa.surfaces.act(id, "drillDown", { id: "enterprise" });
```

## Why generation stays compact

A generated surface is mostly data. OVXA's model never writes the data.

Components bind to host state by path — `{ "$bind": "revenueByMonth" }` — and
the runtime resolves the binding at render time. So the model describes the
interface and nothing else, which means generation cost tracks how many
components the interface has, not how much data they show. The same component
binding serves twelve points or twelve thousand.

## Latency

Streaming emits the surface shell as soon as a plan wins — before generation
starts — so the interface is laid out and labelled while the model is still
working. Measured against `gpt-4.1-mini` on a live request:

```
     3ms  surface.start   kind=comparison  root=0
  1300ms  surface.patch   title
  6876ms  component.add   OptionGrid
  8739ms  component.add   CompareTable
  8937ms  complete
```

Time to a laid-out interface: 3ms. Time to the complete interface: 8.9s. Every
generation reports both, as `timeToShellMs` and `elapsedMs`.

## What the model cannot do

Generated output is data, never behaviour. There is no way to express a
function, a script or a URL scheme, because the schema does not carry one.

Beyond that, every component is checked against the host's registry **as it
streams**, not after:

- the component type must be registered, or the node is dropped
- props must satisfy the registered Zod schema, or the node is dropped
- actions must be registered *and* permitted for the request, or they are stripped
- duplicate ids are rejected, because reconciliation addresses nodes by id

Failures degrade rather than cascade. A document that fails whole-schema
validation is salvaged component by component, so one malformed card costs that
card and not the surface. A stream cut off mid-document keeps whatever already
validated. Only when nothing usable survives does the deterministic compiler
compose a simpler surface — the user never sees broken JSON or a blank screen.

## Interactions preserve what the user is doing

Actions return a patch, not a new surface. Form values, focus, scroll position,
expanded rows and selections survive an interaction, because the nodes are
addressed by id and mutated in place. Most interactions never reach a model at
all: a registered action returns a state patch and the surface re-renders in
milliseconds.

## Compared with OpenUI

[OpenUI](https://github.com/thesysdev/openui) is the closest comparable project
and the honest benchmark for this work. Where it is ahead, it is ahead.

| | OVXA | OpenUI |
| --- | --- | --- |
| Token cost vs JSON | −26.6% structural, −80.4% with bindings | −52.8% (their published benchmark, their baseline) |
| Data transcription | Model never writes data; binds by reference | Data inline in the document |
| Streaming | Token-level, plus structural shell before generation starts | Token-level |
| Validation during streaming | Per-component, fail-closed, against Zod prop schemas | Output restricted to registered components |
| Malformed output | Salvaged per component, then deterministic fallback | Documented as a debugging concern |
| Interaction model | Patch in place; user state preserved | Re-render |
| Interface selection | Several plans proposed, scored and ranked before compiling | Model decides directly |
| Observability | Trace per generation: plan, decision, latency, tokens, quality | Not included |
| Renderers | React | React, Vue, Svelte, CDN bundle, email |
| Prebuilt chat UI | Not yet | Included |
| CLI / scaffolding | Not yet | `npx @openuidev/cli create` |

The short version: OVXA is stronger on cost, correctness and debuggability;
OpenUI is broader on renderers and ships more ready-made surface area. If you
need Vue, Svelte, a script-tag embed or a chat UI out of the box today, theirs
does that and this does not.

## API

| | |
| --- | --- |
| `createOvxa(options)` | Client. `apiKey`, `baseUrl`, `headers`, `timeoutMs`, `fetch`. |
| `generate(request)` | One surface, awaited. |
| `stream(request)` | `AsyncGenerator<SurfaceEvent, StreamSummary>`. |
| `visualize(request)` | Data-first generation. |
| `surfaces.get(id)` | A stored surface and its revision. |
| `surfaces.act(id, actionId, input)` | Run an action, get the patched surface. |
| `surfaces.patch(id, operations)` | Apply your own patch, e.g. from server events. |
| `registry()` | What a model is allowed to reference in this project. |
| `collectSurface(stream, onEvent?)` | Fold a stream into a finished surface. |

Errors are `OvxaError` with `status` and `code`. A path is validated against the
configured origin before any request, so a caller cannot redirect a request
carrying the API key to another host.

## Security

- Never ship a server key to a browser. Use `baseUrl` to point at your own route.
- The model's output is validated against your registry on the server. The client
  is not a trust boundary and does not need to be.
- Component types, prop shapes and action ids are all allowlists.
- `state` you supply is authoritative: a model can add keys it needs, never
  overwrite yours.
