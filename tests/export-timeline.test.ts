import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock timeline-db before importing the tool
vi.mock("../src/lib/timeline-db.js", () => ({
  getTimeline: vi.fn().mockResolvedValue([]),
  listIndexedProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/config.js", () => ({
  getRelatedProjects: vi.fn().mockReturnValue([]),
}));

import { getTimeline } from "../src/lib/timeline-db.js";
import { registerExportTimeline } from "../src/tools/export-timeline.js";

// Capture the handler registered with the server
let toolHandler: any;
const mockServer = {
  tool: (_name: string, _desc: string, _schema: any, handler: any) => {
    toolHandler = handler;
  },
};

describe("export_timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerExportTimeline(mockServer as any);
  });

  it("returns no-projects message when no projects found", async () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    const result = await toolHandler({ scope: "current", format: "markdown", limit: 500 });
    expect(result.content[0].text).toContain("No projects found");
  });

  it("returns no-events message when timeline is empty", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    vi.mocked(getTimeline).mockResolvedValue([]);
    const result = await toolHandler({ scope: "current", format: "markdown", limit: 500 });
    expect(result.content[0].text).toContain("No events found");
  });

  it("generates markdown report with stats", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    vi.mocked(getTimeline).mockResolvedValue([
      { timestamp: "2026-03-01T10:00:00Z", type: "prompt", content: "Fix the login bug", project: "/test" },
      { timestamp: "2026-03-01T10:05:00Z", type: "assistant", content: "I'll fix that", project: "/test" },
      { timestamp: "2026-03-01T10:10:00Z", type: "commit", content: "fix login", commit_hash: "abc1234", project: "/test" },
      { timestamp: "2026-03-01T10:15:00Z", type: "correction", content: "wrong approach", project: "/test" },
    ]);

    const result = await toolHandler({ scope: "current", format: "markdown", limit: 500 });
    const text = result.content[0].text;

    expect(text).toContain("# Session Report");
    expect(text).toContain("## Summary");
    expect(text).toContain("## Quality Indicators");
    expect(text).toContain("Correction rate");
    expect(text).toContain("## Timeline");
    expect(text).toContain("### 2026-03-01");
    expect(text).toContain("`abc1234`");
  });

  it("generates summary format with daily counts", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    vi.mocked(getTimeline).mockResolvedValue([
      { timestamp: "2026-03-01T10:00:00Z", type: "prompt", content: "test", project: "/test" },
      { timestamp: "2026-03-02T10:00:00Z", type: "prompt", content: "test2", project: "/test" },
    ]);

    const result = await toolHandler({ scope: "current", format: "summary", limit: 500 });
    const text = result.content[0].text;

    expect(text).toContain("## Daily Activity");
    expect(text).toContain("**2026-03-01**");
    expect(text).toContain("**2026-03-02**");
    // Should NOT contain detailed timeline section
    expect(text).not.toContain("## Timeline");
  });

  it("filters commits by author", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/test/project";
    vi.mocked(getTimeline).mockResolvedValue([
      { timestamp: "2026-03-01T10:00:00Z", type: "commit", content: "fix", metadata: '{"author":"Alice"}', project: "/test" },
      { timestamp: "2026-03-01T11:00:00Z", type: "commit", content: "refactor", metadata: '{"author":"Bob"}', project: "/test" },
      { timestamp: "2026-03-01T12:00:00Z", type: "prompt", content: "do something", project: "/test" },
    ]);

    const result = await toolHandler({ scope: "current", format: "markdown", author: "alice", limit: 500 });
    const text = result.content[0].text;

    // Should include Alice's commit and the prompt (non-commit events pass through)
    expect(text).toContain("fix");
    expect(text).toContain("do something");
    // Bob's commit should be filtered
    expect(text).not.toContain("refactor");
  });
});
