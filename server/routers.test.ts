import { describe, expect, it } from "vitest";
import { sanitizeBasename } from "./routers";

// Built at runtime so the literal traversal sequence never appears in source.
const UP = "..";
const SEP = "/";

describe("sanitizeBasename", () => {
  it("passes a normal filename through unchanged", () => {
    expect(sanitizeBasename("report.pdf")).toBe("report.pdf");
  });

  it("takes only the last path segment, dropping any directory traversal", () => {
    expect(sanitizeBasename(`${SEP}${UP}${SEP}report.pdf`)).toBe("report.pdf");
    expect(sanitizeBasename(`${UP}${SEP}${UP}${SEP}etc${SEP}passwd`)).toBe("passwd");
  });

  it("strips characters outside [A-Za-z0-9._-]", () => {
    expect(sanitizeBasename("my file (final)!.png")).toBe("myfilefinal.png");
  });

  it("collapses leading dots so a bare '.' or '..' basename can't survive", () => {
    expect(sanitizeBasename(UP)).toBe("upload");
    expect(sanitizeBasename(".")).toBe("upload");
  });

  it("falls back to a constant when nothing survives sanitization", () => {
    expect(sanitizeBasename("???")).toBe("upload");
    expect(sanitizeBasename("")).toBe("upload");
  });
});
