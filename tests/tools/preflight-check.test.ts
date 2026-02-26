import { describe, it, expect } from "vitest";
// We exported extractFilePaths so we can test it directly
import { extractFilePaths } from "../../src/tools/preflight-check.js";

describe("extractFilePaths", () => {
  it("extracts paths with directories", () => {
    expect(extractFilePaths("fix src/auth/jwt.ts line 42")).toEqual(["src/auth/jwt.ts"]);
  });

  it("extracts standalone files with code extensions", () => {
    expect(extractFilePaths("update README.md and package.json")).toEqual([
      "README.md",
      "package.json",
    ]);
  });

  it("filters out Node.js and other framework names", () => {
    expect(extractFilePaths("use Node.js and Vue.js")).toEqual([]);
  });

  it("filters out version numbers", () => {
    expect(extractFilePaths("upgrade to v3.2.0 for 2.5x speed")).toEqual([]);
  });

  it("handles mixed real paths and false positives", () => {
    const result = extractFilePaths(
      "in Node.js v18.0, fix src/lib/triage.ts and update config.yaml"
    );
    expect(result).toEqual(["src/lib/triage.ts", "config.yaml"]);
  });

  it("deduplicates paths", () => {
    expect(extractFilePaths("check src/index.ts then revisit src/index.ts")).toEqual([
      "src/index.ts",
    ]);
  });

  it("returns empty for no file references", () => {
    expect(extractFilePaths("fix the auth bug")).toEqual([]);
  });

  it("handles deeply nested paths", () => {
    expect(extractFilePaths("look at src/lib/utils/helpers.ts")).toEqual([
      "src/lib/utils/helpers.ts",
    ]);
  });
});
