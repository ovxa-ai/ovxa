# Release

Push a version tag after CI is green on `main`.

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions publishes every public workspace package to npm with provenance.
Create the `NPM_TOKEN` repository secret (an npm automation token, or configure
[trusted publishing](https://docs.npmjs.com/trusted-publishers) for `@ovxa/*`).

The landing page in `site/` deploys to GitHub Pages from the `site` workflow on
every push to `main` that touches it. Enable Pages once under
Settings → Pages → Build and deployment → Source: **GitHub Actions** (the
workflow token cannot do this itself), then point the `ovxa.ai` DNS at it or
keep serving it from studio.

Production for the ovxa.ai API is the studio repository. This engine is
consumed there as the `engine` git submodule.
