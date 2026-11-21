import type { Hono } from "hono";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Production-only static serving. In dev, Vite serves the SPA and proxies
// /trpc here, so this is a no-op. In prod there is no Vite: this one process
// serves dist/public and the API together.
//
// This is the ONLY runtime filesystem read in the template, and it is resolved
// relative to cwd so the container can put the app anywhere.
const PUBLIC_DIR = path.resolve(process.cwd(), "dist/public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export function mountSpa(app: Hono): void {
  if (process.env.NODE_ENV !== "production") return;

  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const filePath = path.join(PUBLIC_DIR, rel);

    // Never serve outside the public dir.
    if (!filePath.startsWith(PUBLIC_DIR)) return c.text("Not found", 404);

    try {
      const body = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return c.body(body, 200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    } catch {
      // SPA fallback: any unknown path renders the app shell.
      try {
        const html = await readFile(path.join(PUBLIC_DIR, "index.html"));
        return c.html(html.toString());
      } catch {
        return c.text("Not found", 404);
      }
    }
  });
}
