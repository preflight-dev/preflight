import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock timeline-db before importing the tool
vi.mock("../src/lib/timeline-db.js", () => ({
  getTimeline: vi.fn(),
  listIndexedProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/config.js", () => ({
  getRelatedProjects: vi.fn().mockReturnValue([]),
}));

import { getTimeline } from "../src/lib/timeline-db.js";

// We test the tool handler by registering it on a mock server and capturing the handler
describe("export_report", () => {
  let handler: (params: any) => Promise<any>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Capture the tool handler from register call
    const mockServer = {
      tool: (_name: string, _desc: string, _schema: any, fn: any) => {
        handler = fn;
      },
    };

    const { registerExportReport } = await import(
      "../src/tools/export-report.js"
    );
    registerExportReport(mockServer as any);
  });

  it("returns error when no projects found", async () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    const result = await handler({
      scope: "current",
      period: "week",
    });
    expect(result.content[0].text).toContain("No projects found");
  });

  it("returns no-events message for empty timeline", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    (getTimeline as any).mockResolvedValue([]);

    const result = await handler({
      scope: "current",
      period: "week",
    });
    expect(result.content[0].text).toContain("No events found");
  });

  it("generates a markdown report with stats", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    const now = new Date().toISOString();
    const events = [
      { type: "prompt", timestamp: now, content: "fix the bug" },
      { type: "assistant", timestamp: now, content: "done" },
      { type: "tool_call", timestamp: now, content: "read file", tool_name: "Read" },
      { type: "commit", timestamp: now, content: "fix bug", commit_hash: "abc1234def" },
      { type: "correction", timestamp: now, content: "wrong approach" },
    ];
    (getTimeline as any).mockResolvedValue(events);

    const result = await handler({
      scope: "current",
      period: "week",
    });

    const text = result.content[0].text;
    expect(text).toContain("Weekly Session Report");
    expect(text).toContain("Total Events | 5");
    expect(text).toContain("Correction Rate");
    expect(text).toContain("abc1234");
    expect(text).toContain("Prompt Quality Trends");
  });

  it("requires since for custom period", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    const result = await handler({
      scope: "current",
      period: "custom",
    });
    expect(result.content[0].text).toContain("`since` is required");
  });
});
