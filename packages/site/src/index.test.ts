// @vitest-environment node
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSiteHandler, resolveSiteFile, siteFiles, siteHeaders, siteRoot } from "./index.js";

describe("resolveSiteFile", () => {
  it("serves the page at / and /index.html", () => {
    for (const path of ["/", "", "/index.html", "/?utm=x", "/#top"]) {
      const file = resolveSiteFile(path);
      expect(file?.name, path).toBe("index.html");
      expect(file?.contentType).toBe("text/html; charset=utf-8");
      expect(file?.cacheControl).toBe("no-cache");
    }
  });

  it("serves every shipped asset with its content type", () => {
    expect(siteFiles).toEqual(
      expect.arrayContaining(["index.html", "styles.css", "site.js", "boot.js", "logo.svg", "favicon.svg", "wordmark.svg"]),
    );
    expect(resolveSiteFile("/styles.css")).toMatchObject({
      path: join(siteRoot, "styles.css"),
      contentType: "text/css; charset=utf-8",
      cacheControl: "public, max-age=3600",
    });
    expect(resolveSiteFile("/site.js")?.contentType).toBe("text/javascript; charset=utf-8");
    expect(resolveSiteFile("/logo.svg?v=2")?.contentType).toBe("image/svg+xml");
  });

  it("owns nothing outside the page", () => {
    for (const path of [
      "/login",
      "/signup",
      "/api/generate",
      "/package.json",
      "/../package.json",
      "/%2e%2e/package.json",
      "/public/index.html",
      "/.tsbuildinfo",
      "/%E0%A4%A",
    ]) {
      expect(resolveSiteFile(path), path).toBeNull();
    }
  });
});

describe("createSiteHandler", () => {
  let server: Server;
  let origin: string;
  const fallthrough: string[] = [];

  beforeAll(async () => {
    const site = createSiteHandler({ headers: { "x-served-by": "test" } });
    server = createServer(async (req, res) => {
      if (await site(req, res)) return;
      fallthrough.push(`${req.method} ${req.url}`);
      res.writeHead(404).end("app");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("answers the page with the security headers", async () => {
    const response = await fetch(`${origin}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(siteHeaders["content-security-policy"]);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-served-by")).toBe("test");
    expect(await response.text()).toBe(await readFile(join(siteRoot, "index.html"), "utf8"));
  });

  it("answers HEAD with headers only", async () => {
    const response = await fetch(`${origin}/styles.css`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
    expect(await response.text()).toBe("");
  });

  it("leaves everything else to the host", async () => {
    for (const path of ["/login", "/api/generate", "/../package.json"]) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe("app");
    }
    const post = await fetch(`${origin}/`, { method: "POST" });
    expect(post.status).toBe(404);
    expect(fallthrough).toContain("POST /");
  });
});
