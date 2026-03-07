import { describe, it, expect } from "vitest";

// We test the pure functions by importing the module and checking output shape.
// The tool itself depends on timeline-db, so we test the rendering logic in isolation.

// Since renderMarkdown and computeStats are not exported, we test the tool registration
// indirectly by importing and verifying it doesn't throw.
describe("export-report", () => {
  it("module loads without error", async () => {
    const mod = await import("../src/tools/export-report.js");
    expect(mod.registerExportReport).toBeDefined();
    expect(typeof mod.registerExportReport).toBe("function");
  });
});
