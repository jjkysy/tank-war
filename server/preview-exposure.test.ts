import { describe, expect, it } from "vitest";

// The preview dev server is reachable from the public internet (a share link
// proxies straight to it), so vite.config.ts must not hand out the server
// source tree. This test reads the config as text — it is a guard against a
// future edit widening `fs.allow` back to the workspace root.
import { readFileSync } from "node:fs";
import path from "node:path";

const config = readFileSync(path.resolve(import.meta.dirname, "../vite.config.ts"), "utf8");

describe("vite dev server exposure", () => {
  it("does not allow the whole workspace root through fs.allow", () => {
    expect(config).not.toMatch(/fs:\s*\{\s*allow:\s*\[\s*import\.meta\.dirname\s*\]/);
  });

  it("allows the client and shared trees", () => {
    expect(config).toMatch(/"client"/);
    expect(config).toMatch(/"shared"/);
  });

  it("names the preview hosts explicitly", () => {
    expect(config).toMatch(/allowedHosts/);
  });
});
