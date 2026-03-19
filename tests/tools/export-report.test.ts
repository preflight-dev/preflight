import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock timeline-db before importing the module
vi.mock("../../src/lib/timeline-db.js", () => ({
  getTimeline: vi.fn(),
  listIndexedProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/lib/config.js", () => ({
  getRelatedProjects: vi.fn().mockReturnValue([]),
}));

import { getTimeline } from "../../src/lib/timeline-db.js";

// Helper: create a minimal MCP server mock that captures tool registrations
function createMockServer() {
  const tools: Record<string, { handler: Function; description: string }> = {};
  return {
    tool(name: string, description: string, _schema: any, handler: Function) {
      tools[name] = { handler, description };
    },
    tools,
  };
}

describe("export_report", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createMockServer();
    // Dynamic import to get the register function
    const mod = await import("../../src/tools/export-report.js");
    mod.registerExportReport(server as any);
  });

  it("registers the export_report tool", () => {
    expect(server.tools["export_report"]).toBeDefined();
    expect(server.tools["export_report"].description).toContain("markdown");
  });

  it("returns empty message when no events", async () => {
    vi.mocked(getTimeline).mockResolvedValue([]);
    process.env.CLAUDE_PROJECT_DIR = "/test/project";

    const result = await server.tools["export_report"].handler({
      scope: "current",
      period: "week",
    });

    expect(result.content[0].text).toContain("No events found");
  });

  it("generates report with daily breakdown", async () => {
    vi.mocked(getTimeline).mockResolvedValue([
      { timestamp: "2026-03-15T10:00:00Z", type: "prompt", content: "fix bug", project: "/test", branch: "main", session_id: "s1", source_file: "f1", source_line: 1, metadata: "{}" },
      { timestamp: "2026-03-15T10:05:00Z", type: "assistant", content: "done", project: "/test", branch: "main", session_id: "s1", source_file: "f1", source_line: 2, metadata: "{}" },
      { timestamp: "2026-03-15T10:10:00Z", type: "commit", content: "fix: resolve bug", project: "/test", branch: "main", session_id: "s1", source_file: "f1", source_line: 3, metadata: "{}" },
      { timestamp: "2026-03-16T09:00:00Z", type: "prompt", content: "add test", project: "/test", branch: "main", session_id: "s1", source_file: "f1", source_line: 4, metadata: "{}" },
      { timestamp: "2026-03-16T09:05:00Z", type: "correction", content: "wrong approach", project: "/test", branch: "main", session_id: "s1", source_file: "f1", source_line: 5, metadata: "{}" },
    ] as any);
    process.env.CLAUDE_PROJECT_DIR = "/test";

    const result = await server.tools["export_report"].handler({
      scope: "current",
      period: "week",
    });

    const text = result.content[0].text;
    expect(text).toContain("# Session Report");
    expect(text).toContain("2026-03-15");
    expect(text).toContain("2026-03-16");
    expect(text).toContain("## Summary");
    expect(text).toContain("## Daily Activity");
    expect(text).toContain("## Commits");
    expect(text).toContain("fix: resolve bug");
  });

  it("shows no-project message when scope has no projects", async () => {
    delete process.env.CLAUDE_PROJECT_DIR;

    const result = await server.tools["export_report"].handler({
      scope: "current",
      period: "week",
    });

    expect(result.content[0].text).toContain("No projects found");
  });
});
