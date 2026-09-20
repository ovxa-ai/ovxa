/**
 * Loads every workspace package the way an npm consumer does — through its
 * package.json `exports`, with Node's ESM loader, no bundler and no TypeScript.
 * Catches a missing or stale `dist/`, relative imports without `.js`, and
 * entry points that lost an export, before they reach a release.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url));
const expectedExports = {
  "@ovxa/sdk": ["Ovxa", "OvxaSearch", "createOvxa", "defaultComponents", "defaultUseCases"],
  "@ovxa/client": ["createOvxa", "collectSurface", "OvxaError"],
  "@ovxa/react": ["OVXAProvider", "OVXASurface", "useOvxaSurface", "SurfaceRenderer"],
  "@ovxa/surface-kit": ["createSurfaceRegistry", "createSurfaceActions"],
  "@ovxa/llm": ["resolveLlmConfig", "describeLlmConfig"],
  "@ovxa/site": ["siteRoot", "siteFiles", "resolveSiteFile", "createSiteHandler"],
};

let failed = false;
for (const dir of (await readdir(packagesDir)).sort()) {
  const manifest = JSON.parse(await readFile(`${packagesDir}${dir}/package.json`, "utf8"));
  try {
    const mod = await import(manifest.name);
    const missing = (expectedExports[manifest.name] ?? []).filter((name) => !(name in mod));
    if (missing.length > 0) throw new Error(`missing exports: ${missing.join(", ")}`);
    console.log(`ok   ${manifest.name} (${Object.keys(mod).length} exports)`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${manifest.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) process.exit(1);
