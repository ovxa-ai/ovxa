# @ovxa/sdk

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)

One import. An intent in, a live interface out.

```bash
npm install @ovxa/sdk
```

## Render one intent

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

Streaming, the action loop, and loading / empty / error states are included.

## Let the user ask

`OvxaSearch` is a search box for interfaces. The user types what they need to
do; the engine answers with the interface that does it, rendered underneath.

```tsx
import { OvxaSearch } from "@ovxa/sdk";
import "@ovxa/sdk/styles.css";

<OvxaSearch data={workspace} placeholder="What do you need to do?" />
```

- Suggestions come from `defaultUseCases` until you pass `suggestions`.
- Arrow keys move through suggestions, Enter submits, Escape closes then clears.
- Submitting the same intent again regenerates. `onIntent` fires on every submit.
- Before anything is asked, the use cases are shown as chips — the empty state
  is an invitation, not a blank box.

```tsx
<OvxaSearch
  data={workspace}
  suggestions={[
    { id: "churn", title: "Churn", intent: "Which accounts are at risk this month?", description: "…" },
  ]}
  defaultIntent="Show the health of the payments pipeline"
  onIntent={(intent) => track("ovxa.intent", { intent })}
/>
```

## It looks like your app

A generated surface inherits your `color` and `font`. Every other visual is a
token derived from `currentColor`, so it looks native in an app that never
configured it. To match a design system, set tokens — as a prop or in CSS:

```tsx
<Ovxa intent={intent} data={data} theme={{ radius: "var(--radius)", accent: "hsl(var(--primary))" }} />
```

```css
.ovxa {
  --ovxa-radius: var(--radius);
  --ovxa-border: hsl(var(--border));
  --ovxa-muted: hsl(var(--muted-foreground));
  --ovxa-accent: hsl(var(--primary));
  --ovxa-on-accent: hsl(var(--primary-foreground));
}
```

| Token | Default | Used for |
| --- | --- | --- |
| `radius` | `0.75rem` | Cards, inputs, buttons |
| `border` / `borderStrong` | `currentColor` at 12% / 36% | Hairlines, selected states |
| `muted` | `currentColor` at 62% | Secondary text |
| `fill` | `currentColor` at 5% | Card backgrounds, skeletons, tracks |
| `accent` / `onAccent` | `currentColor` / `Canvas` | Primary actions, bars, selection |
| `success` / `danger` | green / red | Trends, risk, errors |
| `font` | `inherit` | Everything |
| `gap` | `1rem` | Space between components |

When you want your own components, pass `components`. Anything you do not map
keeps the reference renderer, and an unknown type still shows its data.

```tsx
<Ovxa intent={intent} data={data} components={{ StatCard: MyStat, CompareTable: MyTable }} />
```

## Options

Same-origin `/api` is the default. Point `baseUrl` at your OVXA route otherwise:

```tsx
<Ovxa intent={intent} data={data} baseUrl="https://ovxa.ai/api" />
```

Never put a server key in a browser. On the backend:

```ts
import { createOvxa } from "@ovxa/sdk";

const ovxa = createOvxa({
  apiKey: process.env.OVXA_API_KEY,
  baseUrl: "https://ovxa.ai/api",
});

const { surface } = await ovxa.generate({ intent, state: data });
```

Need the provider split, or the raw stream? `OvxaRoot`, `useOvxaSurface` and
`OVXASurfaceView` are on this package. Renderer internals (`SurfaceRenderer`,
`FallbackNode`) stay on `@ovxa/react`.

## Security

- Server keys stay on the server.
- Generated output is data, never executable code.
- Unregistered components and actions are stripped before render.

## License

Apache-2.0
