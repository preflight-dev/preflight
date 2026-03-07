import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before import
vi.mock("../../src/lib/timeline-db.js", () => ({
  getTimeline: vi.fn(),
  listIndexedProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/lib/config.js", () => ({
  getRelatedProjects: vi.fn().mockReturnValue([]),
}));

import { registerExportTimeline } from "../../src/tools/export-timeline.js";
import { getTimeline } from "../../src/lib/timeline-db.js";

// Minimal McpServer mock
function createMockServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools[name] = { handler };
    },
    tools,
  };
}

describe("export_timeline", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMockServer();
    registerExportTimeline(server as any);
    process.env.CLAUDE_PROJECT_DIR = "/tmp/test-project";
  });

  it("registers the tool", () => {
    expect(server.tools["export_timeline"]).toBeDefined();
  });

  it("returns empty message when no events", async () => {
    vi.mocked(getTimeline).mockResolvedValue([]);
    const result = await server.tools["export_timeline"].handler({
      scope: "current",
      type: "all",
      limit: 500,
      offset: 0,
      include_details: true,
    });
    expect(result.content[0].text).toContain("No events found");
  });

  it("generates report with summary stats", async () => {
    vi.mocked(getTimeline).mockResolvedValue([
      { timestamp: "2026-03-01T10:00:00Z", type: "prompt", session_id: "s1", branch: "main", content: "hello" },
      { timestamp: "2026-03-01T10:01:00Z", type: "commit", session_id: "s1", branch: "main", content: "fix bug", commit_hash: "abc1234", metadata: '{"author":"jack"}' },
      { timestamp: "2026-03-02T11:00:00Z", type: "error", session_id: "s2", branch: "dev", content: "something broke" },
    ]);

    const result = await server.tools["export_timeline"].handler({
      scope: "current",
      type: "all",
      limit: 500,
      offset: 0,
      include_details: true,
    });

    const text = result.content[0].text;
    expect(text).toContain("# Timeline Report");
    expect(text).toContain("Total events | 3");
    expect(text).toContain("Active days | 2");
    expect(text).toContain("Sessions | 2");
    expect(text).toContain("Branches | 2");
    expect(text).toContain("## Commits");
    expect(text).toContain("`abc1234`");
    expect(text).toContain("## Issues & Corrections");
    expect(text).toContain("something broke");
    expect(text).toContain("## Event Log");
  });

  it("respects include_details=false", async () => {
    vi.mocked(getTimeline).mockResolvedValue([
      { timestamp: "2026-03-01T10:00:00Z", type: "prompt", session_id: "s1", branch: "main", content: "hi" },
    ]);

    const result = await server.tools["export_timeline"].handler({
      scope: "current",
      type: "all",
      limit: 500,
      offset: 0,
      include_details: false,
    });

    const text = result.content[0].text;
    expect(text).toContain("## Summary");
    expect(text).not.toContain("## Event Log");
  });

  it("uses custom title", async () => {
    vi.mocked(getTimeline).mockResolvedValue([
      { timestamp: "2026-03-01T10:00:00Z", type: "prompt", session_id: "s1", branch: "main", content: "hi" },
    ]);

    const result = await server.tools["export_timeline"].handler({
      scope: "current",
      type: "all",
      limit: 500,
      offset: 0,
      include_details: false,
      title: "Weekly Sprint Report",
    });

    expect(result.content[0].text).toContain("# Weekly Sprint Report");
  });
});
