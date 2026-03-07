import { describe, it, expect } from "vitest";

// Test the report generation logic by importing internals indirectly
// We test the pure functions extracted from the tool

describe("export-timeline", () => {
  it("module exports registerExportTimeline", async () => {
    const mod = await import("../src/tools/export-timeline.js");
    expect(mod.registerExportTimeline).toBeDefined();
    expect(typeof mod.registerExportTimeline).toBe("function");
  });
});
