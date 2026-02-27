import { describe, it, expect } from "vitest";
import { extractFilePaths, detectAmbiguity, estimateComplexity, splitSubtasks } from "../../src/lib/preflight.js";

describe("extractFilePaths", () => {
  it("extracts paths with extensions", () => {
    expect(extractFilePaths("fix src/auth/jwt.ts and update README.md")).toEqual([
      "src/auth/jwt.ts",
      "README.md",
    ]);
  });

  it("deduplicates repeated paths", () => {
    expect(extractFilePaths("check foo.ts then foo.ts again")).toEqual(["foo.ts"]);
  });

  it("returns empty for prompts without file paths", () => {
    expect(extractFilePaths("fix the auth bug")).toEqual([]);
  });

  it("handles nested paths", () => {
    const result = extractFilePaths("edit src/lib/config.ts and utils/helpers.js");
    expect(result).toContain("src/lib/config.ts");
    expect(result).toContain("utils/helpers.js");
  });

  it("matches dotfiles like .env and .gitignore", () => {
    const result = extractFilePaths("check .env and .gitignore");
    expect(result).toContain(".env");
    expect(result).toContain(".gitignore");
  });
});

describe("detectAmbiguity", () => {
  it("flags vague pronouns", () => {
    const issues = detectAmbiguity("fix it and make sure those work correctly with the new system");
    expect(issues.some(i => i.includes("vague pronouns"))).toBe(true);
  });

  it("flags vague verbs without file targets", () => {
    const issues = detectAmbiguity("fix the auth bug and update the tests to match");
    expect(issues.some(i => i.includes("Vague verb"))).toBe(true);
  });

  it("does not flag vague verbs when file targets present", () => {
    const issues = detectAmbiguity("fix the null check in src/auth/jwt.ts line 42 and make sure it handles edge cases");
    expect(issues.some(i => i.includes("Vague verb"))).toBe(false);
  });

  it("flags very short prompts", () => {
    const issues = detectAmbiguity("fix auth");
    expect(issues.some(i => i.includes("Very short"))).toBe(true);
  });

  it("returns empty for clear, specific prompts", () => {
    const issues = detectAmbiguity("Add a null check on line 42 of src/auth/jwt.ts to guard against undefined user tokens");
    expect(issues).toEqual([]);
  });
});

describe("estimateComplexity", () => {
  it("returns SMALL for 0-1 files", () => {
    expect(estimateComplexity([])).toBe("SMALL");
    expect(estimateComplexity(["src/foo.ts"])).toBe("SMALL");
  });

  it("returns MEDIUM for 2-3 files", () => {
    expect(estimateComplexity(["src/a.ts", "src/b.ts"])).toBe("MEDIUM");
  });

  it("returns LARGE for 4+ files across 3+ dirs", () => {
    expect(estimateComplexity([
      "src/a.ts", "lib/b.ts", "tests/c.ts", "config/d.ts"
    ])).toBe("LARGE");
  });

  it("returns MEDIUM for many files in few dirs", () => {
    expect(estimateComplexity([
      "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"
    ])).toBe("MEDIUM");
  });
});

describe("splitSubtasks", () => {
  it("returns single task for simple prompts", () => {
    const tasks = splitSubtasks("add a health check endpoint");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].risk).toBe("🟡 MEDIUM");
  });

  it("splits on 'then'", () => {
    const tasks = splitSubtasks("update the schema then deploy to staging");
    expect(tasks.length).toBeGreaterThan(1);
  });

  it("assigns HIGH risk to schema/migration tasks", () => {
    const tasks = splitSubtasks("update the database schema then fix the UI");
    const schemaTask = tasks.find(t => /schema/i.test(t.task));
    expect(schemaTask?.risk).toBe("🔴 HIGH");
  });

  it("assigns MEDIUM risk to API tasks", () => {
    const tasks = splitSubtasks("create the model then add an API endpoint");
    const apiTask = tasks.find(t => /endpoint/i.test(t.task));
    expect(apiTask?.risk).toBe("🟡 MEDIUM");
  });

  it("assigns LOW risk to generic tasks", () => {
    const tasks = splitSubtasks("write the tests then update the docs");
    const docsTask = tasks.find(t => /docs/i.test(t.task));
    expect(docsTask?.risk).toBe("🟢 LOW");
  });

  it("splits on 'after that' and 'finally'", () => {
    const tasks = splitSubtasks("refactor the module after that write tests finally update the changelog");
    expect(tasks.length).toBe(3);
  });
});
