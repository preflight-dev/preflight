import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock timeline-db before importing the module
vi.mock("../src/lib/timeline-db.js", () => ({
  getTimeline: vi.fn(),
  listIndexedProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/config.js", () => ({
  getRelatedProjects: vi.fn().mockReturnValue([]),
}));

import { getTimeline } from "../src/lib/timeline-db.js";

// We test the tool by calling its handler directly via the server mock
describe("export_timeline", () => {
  const mockEvents = [
    {
      id: "1",
      timestamp: "2026-03-10T10:00:00Z",
      type: "prompt",
      project: "/test",
      content: "How do I fix this bug?",
      session_id: "s1",
    },
    {
      id: "2",
      timestamp: "2026-03-10T10:01:00Z",
      type: "assistant",
      project: "/test",
      content: "Here is the fix...",
      session_id: "s1",
    },
    {
      id: "3",
      timestamp: "2026-03-10T14:00:00Z",
      type: "commit",
      project: "/test",
      content: "fix: resolve null pointer",
      commit_hash: "abc1234def",
      session_id: "s1",
    },
    {
      id: "4",
      timestamp: "2026-03-11T09:00:00Z",
      type: "tool_call",
      project: "/test",
      content: "file.ts",
      tool_name: "Read",
      session_id: "s2",
    },
    {
      id: "5",
      timestamp: "2026-03-11T09:05:00Z",
      type: "error",
      project: "/test",
      content: "Permission denied",
      session_id: "s2",
    },
  ];

  let registeredTools: Map<string, { handler: Function }>;

  beforeEach(async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test";
    vi.mocked(getTimeline).mockResolvedValue(mockEvents as any);
    registeredTools = new Map();

    // Mock MCP server
    const mockServer = {
      tool: (name: string, desc: string, schema: any, handler: Function) => {
        registeredTools.set(name, { handler });
      },
    };

    const { registerExportTimeline } = await import(
      "../src/tools/export-timeline.js"
    );
    registerExportTimeline(mockServer as any);
  });

  async function callTool(params: Record<string, any>) {
    const tool = registeredTools.get("export_timeline")!;
    return tool.handler(params);
  }

  it("generates a summary report", async () => {
    const result = await callTool({
      scope: "current",
      format: "summary",
      type: "all",
      limit: 500,
      offset: 0,
    });
    const text = result.content[0].text;
    expect(text).toContain("# Preflight Timeline Report");
    expect(text).toContain("## Summary");
    expect(text).toContain("Total Events");
    expect(text).toContain("5");
    // Summary format should NOT include daily breakdown
    expect(text).not.toContain("## Daily Breakdown");
  });

  it("generates a detailed report with daily breakdown", async () => {
    const result = await callTool({
      scope: "current",
      format: "detailed",
      type: "all",
      limit: 500,
      offset: 0,
    });
    const text = result.content[0].text;
    expect(text).toContain("## Daily Breakdown");
    expect(text).toContain("2026-03-11");
    expect(text).toContain("2026-03-10");
    expect(text).toContain("## Weekly Trend");
  });

  it("generates a weekly report", async () => {
    const result = await callTool({
      scope: "current",
      format: "weekly",
      type: "all",
      limit: 500,
      offset: 0,
    });
    const text = result.content[0].text;
    expect(text).toContain("## Weekly Trend");
    expect(text).not.toContain("## Daily Breakdown");
  });

  it("shows correct type breakdown", async () => {
    const result = await callTool({
      scope: "current",
      format: "summary",
      type: "all",
      limit: 500,
      offset: 0,
    });
    const text = result.content[0].text;
    // Should show prompt, assistant, commit, tool_call, error
    expect(text).toContain("Prompt");
    expect(text).toContain("Commit");
    expect(text).toContain("Tool Call");
    expect(text).toContain("Error");
  });

  it("returns empty message when no events", async () => {
    vi.mocked(getTimeline).mockResolvedValue([]);
    const result = await callTool({
      scope: "current",
      format: "detailed",
      type: "all",
      limit: 500,
      offset: 0,
    });
    expect(result.content[0].text).toContain("No events found");
  });

  it("returns no projects message when no project dir set", async () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    const result = await callTool({
      scope: "current",
      format: "summary",
      type: "all",
      limit: 500,
      offset: 0,
    });
    expect(result.content[0].text).toContain("No projects found");
  });

  it("generates a JSON report with structured data", async () => {
    const result = await callTool({
      scope: "current",
      format: "json",
      type: "all",
      limit: 500,
      offset: 0,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.stats.totalEvents).toBe(5);
    expect(parsed.events).toHaveLength(5);
    expect(parsed.events[0]).toHaveProperty("timestamp");
    expect(parsed.events[0]).toHaveProperty("type");
    expect(parsed.stats.byType).toHaveProperty("prompt");
    expect(parsed.period).toHaveProperty("from");
    expect(parsed.period).toHaveProperty("to");
  });

  it("includes commit hash and tool name in JSON events", async () => {
    const result = await callTool({
      scope: "current",
      format: "json",
      type: "all",
      limit: 500,
      offset: 0,
    });
    const parsed = JSON.parse(result.content[0].text);
    const commit = parsed.events.find((e: any) => e.type === "commit");
    expect(commit.commitHash).toBe("abc1234def");
    const toolCall = parsed.events.find((e: any) => e.type === "tool_call");
    expect(toolCall.toolName).toBe("Read");
  });

  it("rejects save_to paths that escape project root", async () => {
    const result = await callTool({
      scope: "current",
      format: "detailed",
      type: "all",
      limit: 500,
      offset: 0,
      save_to: "../../../etc/passwd",
    });
    expect(result.content[0].text).toContain("resolves outside the project root");
  });
});
