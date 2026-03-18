import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock timeline-db before importing the module
vi.mock("../../src/lib/timeline-db.js", () => ({
  getTimeline: vi.fn(),
  listIndexedProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/lib/config.js", () => ({
  getRelatedProjects: vi.fn().mockReturnValue([]),
  getConfig: vi.fn().mockReturnValue({ related_projects: [] }),
  hasPreflightConfig: vi.fn().mockReturnValue(false),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExportReport } from "../../src/tools/export-report.js";
import { getTimeline } from "../../src/lib/timeline-db.js";

describe("export_report", () => {
  let server: McpServer;
  let toolHandler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAUDE_PROJECT_DIR = "/test/project";

    // Capture the tool handler when registered
    server = {
      tool: vi.fn((name, desc, schema, handler) => {
        toolHandler = handler;
      }),
    } as any;

    registerExportReport(server);
  });

  it("registers the export_report tool", () => {
    expect(server.tool).toHaveBeenCalledWith(
      "export_report",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns empty message when no events found", async () => {
    vi.mocked(getTimeline).mockResolvedValue([]);

    const result = await toolHandler({
      scope: "current",
      period: "week",
      trends: true,
    });

    expect(result.content[0].text).toContain("No events found");
  });

  it("generates a markdown report with summary table", async () => {
    vi.mocked(getTimeline).mockResolvedValue([
      {
        timestamp: "2026-03-17T10:00:00Z",
        type: "prompt",
        content: "fix the login bug",
        project: "/test/project",
      },
      {
        timestamp: "2026-03-17T10:05:00Z",
        type: "commit",
        content: "fix: resolve login redirect issue",
        commit_hash: "abc1234567890",
        project: "/test/project",
      },
      {
        timestamp: "2026-03-17T11:00:00Z",
        type: "correction",
        content: "no, use the other auth provider",
        project: "/test/project",
      },
      {
        timestamp: "2026-03-18T09:00:00Z",
        type: "prompt",
        content: "add tests for auth module",
        project: "/test/project",
      },
    ]);

    const result = await toolHandler({
      scope: "current",
      period: "week",
      trends: true,
    });

    const text = result.content[0].text;

    // Check header
    expect(text).toContain("Weekly Report");

    // Check summary table
    expect(text).toContain("| Prompts | 2 |");
    expect(text).toContain("| Corrections | 1 |");
    expect(text).toContain("| Commits | 1 |");

    // Check correction rate
    expect(text).toContain("Correction rate:** 50.0%");

    // Check daily breakdown
    expect(text).toContain("Daily Breakdown");
    expect(text).toContain("2026-03-17");
    expect(text).toContain("2026-03-18");

    // Check event log
    expect(text).toContain("Event Log");
    expect(text).toContain("`abc1234`");
    expect(text).toContain("fix the login bug");
  });

  it("skips trends table when disabled", async () => {
    vi.mocked(getTimeline).mockResolvedValue([
      {
        timestamp: "2026-03-17T10:00:00Z",
        type: "prompt",
        content: "test prompt",
        project: "/test/project",
      },
    ]);

    const result = await toolHandler({
      scope: "current",
      period: "day",
      trends: false,
    });

    expect(result.content[0].text).not.toContain("Daily Breakdown");
  });
});
