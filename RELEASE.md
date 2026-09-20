# Release

Push a version tag after CI is green on `main`.

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions publishes every public workspace package to npm with provenance.
Create the `NPM_TOKEN` repository secret (an npm automation token, or configure
[trusted publishing](https://docs.npmjs.com/trusted-publishers) for `@ovxa/*`).

## Landing page

`site/` is a self-contained static page: plain HTML, CSS, and JS with no build
step, no inline scripts or styles, so it runs under a strict
`script-src 'self'; style-src 'self'` CSP.

**https://ovxa.ai is served by the studio server, not by this repository.**
Merging here does not change what ovxa.ai shows. To ship the page there, copy
the contents of `site/` over the studio's static root (it references
`styles.css`, `site.js`, `boot.js`, and the SVGs by relative path) and deploy
studio.

The `site` workflow also publishes `site/` to GitHub Pages on every push to
`main` that touches it. Pages must be enabled once under
Settings → Pages → Build and deployment → Source: **GitHub Actions**; the
workflow token cannot do this itself. To serve ovxa.ai from Pages instead of
studio, set the custom domain in that same settings page and point the
`ovxa.ai` DNS record (Cloudflare) at `ovxa-ai.github.io`.

Production for the ovxa.ai API is the studio repository. This engine is
consumed there as the `engine` git submodule.
