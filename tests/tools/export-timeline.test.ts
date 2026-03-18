import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock timeline-db
vi.mock("../../src/lib/timeline-db.js", () => ({
  getTimeline: vi.fn(),
  listIndexedProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/lib/config.js", () => ({
  getRelatedProjects: vi.fn().mockReturnValue([]),
}));

import { registerExportTimeline } from "../../src/tools/export-timeline.js";
import { getTimeline } from "../../src/lib/timeline-db.js";

const mockedGetTimeline = vi.mocked(getTimeline);

describe("export_timeline", () => {
  let server: McpServer;
  let toolHandler: (params: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Capture the registered tool handler
    server = {
      tool: vi.fn((_name: string, _desc: string, _schema: any, handler: any) => {
        toolHandler = handler;
      }),
    } as unknown as McpServer;
    registerExportTimeline(server);
  });

  it("registers the export_timeline tool", () => {
    expect(server.tool).toHaveBeenCalledWith(
      "export_timeline",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns empty message when no events found", async () => {
    mockedGetTimeline.mockResolvedValue([]);
    process.env.CLAUDE_PROJECT_DIR = "/test/project";

    const result = await toolHandler({
      scope: "current",
      type: "all",
      limit: 500,
    });

    expect(result.content[0].text).toContain("No events found");
  });

  it("generates markdown report with summary stats", async () => {
    mockedGetTimeline.mockResolvedValue([
      {
        id: "1",
        timestamp: "2026-03-15T10:00:00Z",
        type: "prompt",
        project: "/test/project",
        project_name: "project",
        branch: "main",
        session_id: "s1",
        source_file: "f1",
        source_line: 1,
        content: "Add a new feature",
        content_preview: "Add a new feature",
        vector: [],
        metadata: "{}",
      },
      {
        id: "2",
        timestamp: "2026-03-15T10:05:00Z",
        type: "commit",
        project: "/test/project",
        project_name: "project",
        branch: "main",
        session_id: "s1",
        source_file: "f1",
        source_line: 2,
        content: "feat: add new feature",
        content_preview: "feat: add new feature",
        vector: [],
        metadata: "{}",
      },
      {
        id: "3",
        timestamp: "2026-03-15T11:00:00Z",
        type: "error",
        project: "/test/project",
        project_name: "project",
        branch: "main",
        session_id: "s1",
        source_file: "f1",
        source_line: 3,
        content: "Build failed",
        content_preview: "Build failed",
        vector: [],
        metadata: "{}",
      },
    ] as any);
    process.env.CLAUDE_PROJECT_DIR = "/test/project";

    const result = await toolHandler({
      scope: "current",
      type: "all",
      limit: 500,
    });

    const text = result.content[0].text;
    expect(text).toContain("# Session Report:");
    expect(text).toContain("## Summary");
    expect(text).toContain("Total Events | 3");
    expect(text).toContain("Prompts | 1");
    expect(text).toContain("Commits | 1");
    expect(text).toContain("Errors | 1");
    expect(text).toContain("## Quality Indicators");
    expect(text).toContain("## Daily Breakdown");
    expect(text).toContain("### 2026-03-15");
  });

  it("handles relative date parsing", async () => {
    mockedGetTimeline.mockResolvedValue([]);
    process.env.CLAUDE_PROJECT_DIR = "/test/project";

    await toolHandler({
      scope: "current",
      since: "7days",
      type: "all",
      limit: 500,
    });

    expect(mockedGetTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });
});
