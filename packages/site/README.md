# @ovxa/site

The [ovxa.ai](https://ovxa.ai) landing page: `public/` holds the static files,
and the module serves them from any Node HTTP server. Studio mounts this from
the `engine` submodule, so the page is deployed with the API and there is no
second copy to keep in sync.

`public/` is plain HTML, CSS and JS with no inline scripts or styles. It runs
under the strict Content Security Policy in `siteHeaders`
(`script-src 'self'; style-src 'self'`).

## Serve it

The handler takes Node's `IncomingMessage` / `ServerResponse`, which every
framework exposes as its raw request and response. It answers `GET` and `HEAD`
for `/`, `/index.html` and the shipped assets, and resolves `false` for
everything else so the host keeps `/login`, `/signup` and `/api/*`.

```ts
import { createServer } from "node:http";
import { createSiteHandler } from "@ovxa/site";

const site = createSiteHandler();

createServer(async (req, res) => {
  if (await site(req, res)) return;
  app(req, res);
}).listen(8080);
```

### Fastify (studio)

```ts
import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { resolveSiteFile, siteFiles, siteHeaders } from "@ovxa/site";

export async function registerSite(app: FastifyInstance): Promise<void> {
  for (const route of ["/", ...siteFiles.map((name) => `/${name}`)]) {
    app.get(route, (request, reply) => {
      const file = resolveSiteFile(request.url);
      if (!file) return reply.callNotFound();
      return reply
        .headers({ ...siteHeaders, "cache-control": file.cacheControl })
        .type(file.contentType)
        .send(createReadStream(file.path));
    });
  }
}
```

Register it before the API plugins. Routes are explicit, so nothing here
shadows an application route that is not a landing-page file.

### Anything else

`siteRoot` is the absolute path of `public/`. Hand it to `@fastify/static`,
`express.static`, or a CDN upload step; `siteFiles` lists what is in it.

## API

| | |
| --- | --- |
| `siteRoot` | Absolute path of the static files. |
| `siteFiles` | Names of the shipped files, the allowlist the resolver uses. |
| `siteHeaders` | CSP and hardening headers every response carries. |
| `resolveSiteFile(urlPath)` | `{ name, path, contentType, cacheControl }` or `null` when the page does not own the path. Ignores query strings; rejects anything that is not an exact shipped name. |
| `createSiteHandler({ headers? })` | `(req, res) => Promise<boolean>`; `true` when the request was answered. |

## Preview

```bash
python3 -m http.server -d packages/site/public 4173
```

## License

Apache-2.0
