import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPreflightCheck } from "../src/tools/preflight-check.js";

// Mock all external dependencies
vi.mock("../src/lib/git.js", () => ({
  run: vi.fn().mockReturnValue(""),
  getBranch: vi.fn().mockReturnValue("main"),
  getStatus: vi.fn().mockReturnValue("M src/index.ts"),
  getRecentCommits: vi.fn().mockReturnValue("abc1234 feat: initial commit"),
  getDiffFiles: vi.fn().mockReturnValue("src/index.ts"),
  getStagedFiles: vi.fn().mockReturnValue(""),
}));

vi.mock("../src/lib/state.js", () => ({
  now: vi.fn().mockReturnValue("2026-03-19T09:00:00.000Z"),
}));

vi.mock("../src/lib/files.js", () => ({
  PROJECT_DIR: "/tmp/test-project",
  findWorkspaceDocs: vi.fn().mockReturnValue({}),
}));

vi.mock("../src/lib/config.js", () => ({
  getConfig: vi.fn().mockReturnValue({
    triage: {
      strictness: "normal",
      rules: {
        always_check: [],
        skip: [],
        cross_service_keywords: ["api", "schema", "contract"],
      },
    },
    related_projects: [],
  }),
}));

vi.mock("../src/lib/timeline-db.js", () => ({
  searchSemantic: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/patterns.js", () => ({
  loadPatterns: vi.fn().mockReturnValue([]),
  matchPatterns: vi.fn().mockReturnValue([]),
  formatPatternMatches: vi.fn().mockReturnValue(""),
}));

describe("preflight_check", () => {
  let toolHandler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const originalTool = server.tool.bind(server);
    server.tool = ((...args: any[]) => {
      toolHandler = args[args.length - 1];
      return originalTool(...args);
    }) as any;
    registerPreflightCheck(server);
  });

  it("returns clear for trivial prompts", async () => {
    const result = await toolHandler({
      prompt: "fix the typo in README.md",
    });
    const text = result.content[0].text;
    expect(text).toContain("✅ Preflight: clear to proceed.");
  });

  it("force_level=skip always passes through", async () => {
    const result = await toolHandler({
      prompt: "rewrite the entire codebase and deploy to production then migrate the database",
      force_level: "skip",
    });
    const text = result.content[0].text;
    expect(text).toBe("✅ Preflight: clear to proceed.");
  });

  it("detects ambiguous prompts with vague pronouns", async () => {
    const result = await toolHandler({
      prompt: "fix it",
      force_level: "light",
    });
    const text = result.content[0].text;
    expect(text).toContain("Preflight Check");
    expect(text).toContain("Clarification");
    expect(text).toContain("vague pronouns");
  });

  it("detects very short prompts as needing clarification", async () => {
    const result = await toolHandler({
      prompt: "update",
      force_level: "light",
    });
    const text = result.content[0].text;
    expect(text).toContain("Clarification");
    expect(text).toContain("Very short prompt");
  });

  it("builds execution plan for multi-step prompts", async () => {
    const result = await toolHandler({
      prompt: "update the schema then fix the API routes then deploy to production",
      force_level: "full",
    });
    const text = result.content[0].text;
    expect(text).toContain("Execution Plan");
    expect(text).toContain("Checkpoints");
    expect(text).toContain("Scope");
  });

  it("includes git state in clarification section", async () => {
    const result = await toolHandler({
      prompt: "refactor those components",
      force_level: "light",
    });
    const text = result.content[0].text;
    expect(text).toContain("Git State");
    expect(text).toContain("Branch: `main`");
    expect(text).toContain("Dirty files: 1");
  });

  it("shows triage confidence and reasons", async () => {
    const result = await toolHandler({
      prompt: "fix it and update them",
      force_level: "light",
    });
    const text = result.content[0].text;
    expect(text).toContain("Triage:");
    expect(text).toContain("confidence:");
  });

  it("flags vague verbs without file targets", async () => {
    const result = await toolHandler({
      prompt: "refactor the code to be better",
      force_level: "light",
    });
    const text = result.content[0].text;
    expect(text).toContain("Vague verb without specific file targets");
  });

  it("boosts triage level when patterns match", async () => {
    const { matchPatterns } = await import("../src/lib/patterns.js");
    (matchPatterns as any).mockReturnValueOnce([
      { pattern: "forgot to import", frequency: 3 },
    ]);

    const result = await toolHandler({
      prompt: "add the auth check to login.ts",
    });
    const text = result.content[0].text;
    // Should no longer be trivial — pattern match boosts it
    expect(text).toContain("Known pitfall");
    expect(text).toContain("corrected this 3x before");
  });

  it("assigns risk levels in execution plan", async () => {
    const result = await toolHandler({
      prompt: "update the database schema then change the API endpoint then update the frontend",
      force_level: "full",
    });
    const text = result.content[0].text;
    // Schema changes should be HIGH risk
    expect(text).toContain("🔴 HIGH");
    // API changes should be MEDIUM risk
    expect(text).toContain("🟡 MEDIUM");
  });
});
