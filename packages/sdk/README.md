# @ovxa/sdk

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)

One import. An intent in, a live interface out.

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

The client, provider, reference renderers, actions, streaming, and loading /
empty / error states are included.

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

When you are ready for your design system, pass `components`. Until then every
registered type still renders, and an unknown type still shows the data.

```tsx
<Ovxa intent={intent} data={data} components={yourMap} actions={yourActions} />
```

Need the provider split, or the raw stream? `OVXAProvider` and `createOvxa` are
on this package. Renderer internals (`SurfaceRenderer`, `FallbackNode`) stay on
`@ovxa/react`.

## Security

- Server keys stay on the server.
- Generated output is data, never executable code.
- Unregistered components and actions are stripped before render.

## License

Apache-2.0
