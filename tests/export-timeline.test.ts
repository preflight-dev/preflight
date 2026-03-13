import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock timeline-db before importing the module
vi.mock("../src/lib/timeline-db.js", () => ({
  getTimeline: vi.fn(),
  listIndexedProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/config.js", () => ({
  getRelatedProjects: vi.fn().mockReturnValue([]),
}));

import { registerExportTimeline } from "../src/tools/export-timeline.js";
import { getTimeline } from "../src/lib/timeline-db.js";

describe("export_timeline", () => {
  let server: McpServer;
  let registeredHandler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Capture the handler registered with server.tool()
    server = {
      tool: vi.fn((_name: string, _desc: string, _schema: any, handler: any) => {
        registeredHandler = handler;
      }),
    } as any;
    registerExportTimeline(server);
  });

  it("registers the export_timeline tool", () => {
    expect(server.tool).toHaveBeenCalledWith(
      "export_timeline",
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it("returns empty message when no events found", async () => {
    vi.mocked(getTimeline).mockResolvedValue([]);
    process.env.CLAUDE_PROJECT_DIR = "/tmp/test-project";

    const result = await registeredHandler({
      scope: "current",
      limit: 500,
    });

    expect(result.content[0].text).toContain("No events found");
  });

  it("generates markdown report with stats", async () => {
    vi.mocked(getTimeline).mockResolvedValue([
      {
        timestamp: "2026-03-12T10:00:00Z",
        type: "prompt",
        content: "Fix the login bug",
        project: "/tmp/test",
      },
      {
        timestamp: "2026-03-12T10:05:00Z",
        type: "commit",
        content: "fix: login validation",
        commit_hash: "abc1234def",
        project: "/tmp/test",
      },
      {
        timestamp: "2026-03-12T10:03:00Z",
        type: "tool_call",
        content: "src/auth.ts",
        tool_name: "Read",
        project: "/tmp/test",
      },
      {
        timestamp: "2026-03-12T10:04:00Z",
        type: "correction",
        content: "Wrong file edited",
        project: "/tmp/test",
      },
    ]);
    process.env.CLAUDE_PROJECT_DIR = "/tmp/test";

    const result = await registeredHandler({
      scope: "current",
      limit: 500,
      title: "Weekly Dev Report",
    });

    const text = result.content[0].text;
    expect(text).toContain("# Weekly Dev Report");
    expect(text).toContain("## Summary");
    expect(text).toContain("| Total events | 4 |");
    expect(text).toContain("| Prompts | 1 |");
    expect(text).toContain("| Commits | 1 |");
    expect(text).toContain("| Corrections | 1 |");
    expect(text).toContain("## Correction Patterns");
    expect(text).toContain("Wrong file edited");
    expect(text).toContain("## Daily Timeline");
    expect(text).toContain("### 2026-03-12");
  });

  it("returns error when no projects found", async () => {
    delete process.env.CLAUDE_PROJECT_DIR;

    const result = await registeredHandler({
      scope: "current",
      limit: 500,
    });

    expect(result.content[0].text).toContain("No projects found");
  });
});
