# @ovxa/sdk

The OVXA SDK. One import. An intent in, a live interface out.

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

That is the whole integration. The client, the provider, reference renderers,
actions, streaming, and loading / empty / error states are included.

Point `baseUrl` at your OVXA route if it is not same-origin `/api`:

```tsx
<Ovxa intent={intent} data={data} baseUrl="https://ovxa.ai/api" />
```

Never put a server key in a browser. For a backend:

```ts
import { createOvxa } from "@ovxa/sdk";

const ovxa = createOvxa({
  apiKey: process.env.OVXA_API_KEY,
  baseUrl: "https://ovxa.ai/api",
});

const { surface } = await ovxa.generate({ intent, state: data });
```

When you are ready for your own design system, pass `components`. Until then
every registered type still renders, and an unknown type still shows the data
rather than a blank node.

```tsx
<Ovxa intent={intent} data={data} components={yourMap} actions={yourActions} />
```
