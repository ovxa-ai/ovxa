# Release

Push a version tag after CI is green on `main`.

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions publishes every public workspace package to npm with provenance.
Create the `NPM_TOKEN` repository secret (an npm automation token, or configure
[trusted publishing](https://docs.npmjs.com/trusted-publishers) for `@ovxa/*`).

Production for ovxa.ai is the studio repository. This engine is consumed there
as the `engine` git submodule.
