import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the internal helpers by importing the module and exercising the
// registration via a mock MCP server that captures the handler.

// Mock external deps before importing
vi.mock("../../src/lib/git.js", () => ({
  run: vi.fn(() => ""),
  getBranch: vi.fn(() => "main"),
  getStatus: vi.fn(() => "M src/index.ts"),
  getRecentCommits: vi.fn(() => "abc1234 fix: thing"),
  getDiffFiles: vi.fn(() => []),
  getStagedFiles: vi.fn(() => []),
}));

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/tmp/test-project",
  findWorkspaceDocs: vi.fn(() => ({})),
}));

vi.mock("../../src/lib/config.js", () => ({
  getConfig: vi.fn(() => ({
    related_projects: [],
    triage: {
      rules: {
        always_check: [],
        skip: [],
        cross_service_keywords: [],
      },
      strictness: "normal",
    },
  })),
}));

vi.mock("../../src/lib/timeline-db.js", () => ({
  searchSemantic: vi.fn(async () => []),
}));

vi.mock("../../src/lib/patterns.js", () => ({
  loadPatterns: vi.fn(() => []),
  matchPatterns: vi.fn(() => []),
  formatPatternMatches: vi.fn(() => ""),
}));

vi.mock("../../src/lib/state.js", () => ({
  now: vi.fn(() => "2026-03-02T19:00:00"),
}));

// Capture the tool handler from registerPreflightCheck
let preflightHandler: (args: { prompt: string; force_level?: string }) => Promise<{ content: { type: string; text: string }[] }>;

const mockServer = {
  tool: vi.fn((_name: string, _desc: string, _schema: unknown, handler: typeof preflightHandler) => {
    preflightHandler = handler;
  }),
};

import { registerPreflightCheck } from "../../src/tools/preflight-check.js";

describe("preflight_check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerPreflightCheck(mockServer as never);
  });

  it("registers the tool with correct name", () => {
    expect(mockServer.tool).toHaveBeenCalledWith(
      "preflight_check",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns pass-through on force_level=skip", async () => {
    const result = await preflightHandler({ prompt: "anything", force_level: "skip" });
    expect(result.content[0].text).toBe("✅ Preflight: clear to proceed.");
  });

  it("returns clear for trivial prompts", async () => {
    const result = await preflightHandler({ prompt: "commit" });
    expect(result.content[0].text).toContain("✅ Preflight: clear to proceed.");
  });

  it("includes clarification for ambiguous prompts", async () => {
    const result = await preflightHandler({ prompt: "fix the auth bug that's been causing issues with the login flow" });
    const text = result.content[0].text;
    // Should have triage info and clarify section
    expect(text).toContain("Preflight Check");
    expect(text).toContain("Git State");
  });

  it("force_level=full triggers full analysis", async () => {
    const result = await preflightHandler({
      prompt: "refactor the entire auth module and then update all the API consumers and deploy",
      force_level: "full",
    });
    const text = result.content[0].text;
    expect(text).toContain("Execution Plan");
    expect(text).toContain("Sequence");
    expect(text).toContain("Scope");
  });

  it("force_level=light triggers clarify only", async () => {
    const result = await preflightHandler({
      prompt: "do the thing",
      force_level: "light",
    });
    const text = result.content[0].text;
    expect(text).toContain("Clarification");
    expect(text).not.toContain("Execution Plan");
  });

  it("detects vague pronouns in ambiguous prompts", async () => {
    const result = await preflightHandler({
      prompt: "fix it and update those things that are broken in the module",
      force_level: "light",
    });
    const text = result.content[0].text;
    expect(text).toContain("Clarification Needed");
  });

  it("detects short prompts as needing clarification", async () => {
    const result = await preflightHandler({
      prompt: "fix bug",
      force_level: "light",
    });
    const text = result.content[0].text;
    expect(text).toContain("Very short prompt");
  });

  it("splits multi-step prompts into subtasks", async () => {
    const result = await preflightHandler({
      prompt: "update the database schema then migrate the data then deploy to staging",
      force_level: "full",
    });
    const text = result.content[0].text;
    // Should have numbered steps
    expect(text).toMatch(/1\./);
    expect(text).toMatch(/2\./);
    expect(text).toMatch(/3\./);
  });

  it("assigns risk levels to subtasks", async () => {
    const result = await preflightHandler({
      prompt: "update the database schema then add an api endpoint then fix the button color",
      force_level: "full",
    });
    const text = result.content[0].text;
    expect(text).toContain("🔴 HIGH"); // database/schema
    expect(text).toContain("🟡 MEDIUM"); // api endpoint
    expect(text).toContain("🟢 LOW"); // button color
  });
});
