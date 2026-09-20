/**
 * The ovxa.ai landing page, packaged so the studio server can serve it from
 * the engine submodule instead of carrying a copy.
 *
 *   import { createSiteHandler } from "@ovxa/site";
 *   const site = createSiteHandler();
 *   http.createServer(async (req, res) => { if (!(await site(req, res))) app(req, res); });
 *
 * `public/` is plain HTML, CSS and JS with no inline code, so it runs under
 * the strict Content Security Policy in `siteHeaders`. This module is a
 * request handler, not a server: the host owns listening, TLS and routing.
 */
import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the directory holding the static files. */
export const siteRoot: string = fileURLToPath(new URL("../public/", import.meta.url));

/** Response headers every landing-page response carries. */
export const siteHeaders: Readonly<Record<string, string>> = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".woff2": "font/woff2",
};

const INDEX = "index.html";

/**
 * Files the page is allowed to serve. Read once: the directory is flat and
 * changes only with a deploy. Acts as an allowlist, so a request can never
 * reach a path that is not one of these names.
 */
export const siteFiles: readonly string[] = Object.freeze(
  readdirSync(siteRoot)
    .filter(
      (name: string) =>
        !name.startsWith(".") && extname(name) in CONTENT_TYPES && statSync(join(siteRoot, name)).isFile(),
    )
    .sort(),
);

export type SiteFile = {
  /** File name inside `siteRoot`, e.g. `styles.css`. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  contentType: string;
  cacheControl: string;
};

/**
 * Maps a request path to a file in `public/`, or `null` when the landing page
 * does not own that path. `/` and `/index.html` are the page; anything else
 * must be the exact name of a shipped asset. Query strings are ignored.
 */
export function resolveSiteFile(urlPath: string): SiteFile | null {
  const pathname = urlPath.split(/[?#]/, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const name = decoded === "/" || decoded === "" ? INDEX : decoded.replace(/^\/+/, "");
  if (!siteFiles.includes(name)) return null;
  const contentType = CONTENT_TYPES[extname(name)];
  if (!contentType) return null;
  return {
    name,
    path: join(siteRoot, name),
    contentType,
    // The HTML has no fingerprinted asset names, so revalidate it on every
    // visit and let the assets live a little longer.
    cacheControl: name === INDEX ? "no-cache" : "public, max-age=3600",
  };
}

export type SiteHandlerOptions = {
  /** Extra or overriding response headers, e.g. a stricter CSP. */
  headers?: Record<string, string>;
};

export type SiteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

/**
 * Serves the landing page on Node's `http` types, which every framework
 * exposes as its raw request and response. Resolves `true` when the request
 * was a landing-page GET/HEAD and has been answered; `false` when the host
 * should handle it (its API, `/login`, `/signup`, …).
 */
export function createSiteHandler(options: SiteHandlerOptions = {}): SiteHandler {
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const file = resolveSiteFile(req.url ?? "/");
    if (!file) return false;
    const body = await readFile(file.path);
    res.writeHead(200, {
      ...siteHeaders,
      ...options.headers,
      "content-type": file.contentType,
      "cache-control": file.cacheControl,
      "content-length": String(body.byteLength),
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}
