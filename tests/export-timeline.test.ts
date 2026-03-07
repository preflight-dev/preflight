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

// We test the tool by calling its handler via a mock McpServer
describe("export_timeline", () => {
  let toolHandler: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Capture the tool handler when registerExportTimeline calls server.tool()
    const mockServer = {
      tool: vi.fn((_name: string, _desc: string, _schema: any, handler: Function) => {
        toolHandler = handler;
      }),
    };

    const { registerExportTimeline } = await import("../src/tools/export-timeline.js");
    registerExportTimeline(mockServer as any);
  });

  it("returns no-projects message when scope yields nothing", async () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    const result = await toolHandler({ scope: "current", format: "summary" });
    expect(result.content[0].text).toContain("No projects found");
  });

  it("generates a summary report from timeline events", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    const mockEvents = [
      { timestamp: "2026-03-01T10:00:00Z", type: "prompt", content: "Hello", project: "/test/project", branch: "main", session_id: "s1", source_file: "f", source_line: 1 },
      { timestamp: "2026-03-01T10:01:00Z", type: "assistant", content: "Hi there", project: "/test/project", branch: "main", session_id: "s1", source_file: "f", source_line: 2 },
      { timestamp: "2026-03-01T10:05:00Z", type: "correction", content: "Wrong answer", project: "/test/project", branch: "main", session_id: "s1", source_file: "f", source_line: 3 },
      { timestamp: "2026-03-02T09:00:00Z", type: "commit", content: "fix bug", commit_hash: "abc1234", project: "/test/project", branch: "main", session_id: "s1", source_file: "f", source_line: 4 },
    ];
    vi.mocked(getTimeline).mockResolvedValue(mockEvents as any);

    const result = await toolHandler({ scope: "current", format: "summary", since: "7days" });
    const text = result.content[0].text;

    expect(text).toContain("# Session Report");
    expect(text).toContain("Total Events:** 4");
    expect(text).toContain("Days Active:** 2");
    expect(text).toContain("Correction Rate");
    expect(text).toContain("## Trends");
  });

  it("generates detailed report with event listings", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    const mockEvents = [
      { timestamp: "2026-03-01T10:00:00Z", type: "prompt", content: "Hello world", project: "/test/project", branch: "main", session_id: "s1", source_file: "f", source_line: 1 },
      { timestamp: "2026-03-01T10:01:00Z", type: "tool_call", tool_name: "Read", content: "file.ts", project: "/test/project", branch: "main", session_id: "s1", source_file: "f", source_line: 2 },
    ];
    vi.mocked(getTimeline).mockResolvedValue(mockEvents as any);

    const result = await toolHandler({ scope: "current", format: "detailed", since: "7days" });
    const text = result.content[0].text;

    expect(text).toContain("**10:00** [Prompt]");
    expect(text).toContain("**10:01** [Tool Call] `Read`");
  });

  it("returns no-events message when timeline is empty", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    vi.mocked(getTimeline).mockResolvedValue([]);

    const result = await toolHandler({ scope: "current", format: "summary", since: "7days" });
    expect(result.content[0].text).toContain("No events found");
  });
});
