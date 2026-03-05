import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock timeline-db before importing the module
vi.mock("../src/lib/timeline-db.js", () => ({
  getTimeline: vi.fn(),
  listIndexedProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/config.js", () => ({
  getRelatedProjects: vi.fn().mockReturnValue([]),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline } from "../src/lib/timeline-db.js";
import { registerExportReport } from "../src/tools/export-report.js";

describe("export_report", () => {
  let server: McpServer;
  let registeredHandler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Capture the handler when tool is registered
    server = {
      tool: vi.fn((name, desc, schema, handler) => {
        registeredHandler = handler;
      }),
    } as any;
    registerExportReport(server);
  });

  it("registers the tool", () => {
    expect(server.tool).toHaveBeenCalledWith(
      "export_report",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns no-events message for empty timeline", async () => {
    vi.mocked(getTimeline).mockResolvedValue([]);
    process.env.CLAUDE_PROJECT_DIR = "/test/project";

    const result = await registeredHandler({
      scope: "current",
      format: "weekly",
      save: false,
    });

    expect(result.content[0].text).toContain("No events found");
  });

  it("generates weekly report with commits and corrections", async () => {
    const now = new Date().toISOString();
    vi.mocked(getTimeline).mockResolvedValue([
      { timestamp: now, type: "prompt", content: "fix the bug", project_name: "test-proj" },
      { timestamp: now, type: "commit", content: "fix: resolved bug", commit_hash: "abc1234def" },
      { timestamp: now, type: "correction", content: "wrong approach first time" },
      { timestamp: now, type: "error", content: "type error in foo.ts" },
    ]);
    process.env.CLAUDE_PROJECT_DIR = "/test/project";

    const result = await registeredHandler({
      scope: "current",
      format: "weekly",
      save: false,
    });

    const text = result.content[0].text;
    expect(text).toContain("Weekly Report");
    expect(text).toContain("abc1234");
    expect(text).toContain("wrong approach");
    expect(text).toContain("Correction rate");
    expect(text).toContain("type error in foo.ts");
  });

  it("generates activity report with heatmap", async () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      type: "prompt",
      content: `prompt ${i}`,
      project_name: "test-proj",
    }));
    vi.mocked(getTimeline).mockResolvedValue(events);
    process.env.CLAUDE_PROJECT_DIR = "/test/project";

    const result = await registeredHandler({
      scope: "current",
      format: "activity",
      save: false,
    });

    const text = result.content[0].text;
    expect(text).toContain("Activity Report");
    expect(text).toContain("Activity Heatmap");
    expect(text).toContain("█");
  });
});
