# Release

Push a version tag after CI is green on `main`.

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions builds every package (`npm run build`), runs the type check,
tests and `npm run check:dist`, then publishes every public workspace package to
npm with provenance. Only `dist/` (built ESM and `.d.ts`) is published, plus
`src/styles.css` for `@ovxa/sdk`. Create the `NPM_TOKEN` repository secret (an
npm automation token, or configure
[trusted publishing](https://docs.npmjs.com/trusted-publishers) for `@ovxa/*`).

To inspect exactly what a release ships:

```bash
npm pack --workspaces --pack-destination /tmp/ovxa-packs
```

## Landing page

`site/` is a self-contained static page: plain HTML, CSS, and JS with no build
step, no inline scripts or styles, so it runs under a strict
`script-src 'self'; style-src 'self'` CSP.

**https://ovxa.ai is served by the studio server, not by this repository.**
Merging here does not change what ovxa.ai shows. To ship the page there, copy
the contents of `site/` over the studio's static root (it references
`styles.css`, `site.js`, `boot.js`, and the SVGs by relative path) and deploy
studio.

### Automatic publishing to GitHub Pages

The `site` workflow publishes `site/` to GitHub Pages on every push to `main`
that touches it, and provisions everything around it when given credentials.
Configure once under Settings → Secrets and variables → Actions:

| Name | Kind | Purpose |
| --- | --- | --- |
| `PAGES_ADMIN_TOKEN` | secret | Fine-grained PAT scoped to this repository with **Pages: read and write**. The workflow uses it to enable Pages (source: GitHub Actions) and set the custom domain. Without it, Pages must be enabled by hand once. |
| `SITE_DOMAIN` | variable | Hostname to serve the page on, e.g. `ovxa.ai` or `www.ovxa.ai`. Set as the Pages custom domain. |
| `CLOUDFLARE_API_TOKEN` | secret | Cloudflare token with **Zone → DNS → Edit** on the zone. With `SITE_DOMAIN` set, the workflow replaces that hostname's address records with `CNAME ovxa-ai.github.io` (DNS-only, so GitHub can issue HTTPS). |

Pointing the apex `ovxa.ai` at Pages takes the hostname away from the studio
server, so `/login`, `/signup` and `/api/*` must live on another hostname
(e.g. `app.ovxa.ai`) first. Use `www.ovxa.ai` or `site.ovxa.ai` as
`SITE_DOMAIN` to publish without touching the app.

Every step is idempotent: re-running the workflow with the same configuration
changes nothing.

Production for the ovxa.ai API is the studio repository. This engine is
consumed there as the `engine` git submodule.
