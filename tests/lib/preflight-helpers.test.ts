import { describe, it, expect } from "vitest";
import {
  extractFilePaths,
  detectAmbiguity,
  estimateComplexity,
  splitSubtasks,
} from "../../src/lib/preflight-helpers.js";

describe("extractFilePaths", () => {
  it("extracts simple file paths", () => {
    expect(extractFilePaths("fix src/auth/jwt.ts")).toContain("src/auth/jwt.ts");
  });

  it("extracts multiple file paths", () => {
    const paths = extractFilePaths("update src/index.ts and lib/utils.js");
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("lib/utils.js");
  });

  it("deduplicates paths", () => {
    const paths = extractFilePaths("fix src/a.ts then check src/a.ts");
    expect(paths.filter(p => p === "src/a.ts")).toHaveLength(1);
  });

  it("returns empty for no file paths", () => {
    expect(extractFilePaths("fix the auth bug")).toEqual([]);
  });

  it("matches bare dotfiles like .env", () => {
    expect(extractFilePaths("update .env")).toContain(".env");
  });

  it("matches dotfiles with extensions like .env.local", () => {
    expect(extractFilePaths("check .env.local")).toContain(".env.local");
  });

  it("matches .gitignore", () => {
    expect(extractFilePaths("update .gitignore")).toContain(".gitignore");
  });

  it("matches dotfiles with directory prefix", () => {
    expect(extractFilePaths("update config/.env")).toContain("config/.env");
  });

  it("does not match lone dots or numbers", () => {
    const paths = extractFilePaths("version 2.0 is ready");
    expect(paths).not.toContain(".0");
  });
});

describe("detectAmbiguity", () => {
  it("detects vague pronouns", () => {
    const issues = detectAmbiguity("fix it");
    expect(issues.some(i => i.includes("vague pronouns"))).toBe(true);
  });

  it("detects vague verbs without file targets", () => {
    const issues = detectAmbiguity("fix the auth bug");
    expect(issues.some(i => i.includes("Vague verb"))).toBe(true);
  });

  it("does not flag vague verbs when file paths present", () => {
    const issues = detectAmbiguity("fix the bug in src/auth/jwt.ts");
    expect(issues.some(i => i.includes("Vague verb"))).toBe(false);
  });

  it("flags very short prompts", () => {
    const issues = detectAmbiguity("fix bug");
    expect(issues.some(i => i.includes("Very short"))).toBe(true);
  });

  it("returns empty for clear prompts with file refs", () => {
    const issues = detectAmbiguity("Add error handling to the validateToken function in src/auth/jwt.ts for expired tokens");
    expect(issues).toEqual([]);
  });
});

describe("estimateComplexity", () => {
  it("returns SMALL for 0-1 files", () => {
    expect(estimateComplexity([])).toBe("SMALL");
    expect(estimateComplexity(["src/a.ts"])).toBe("SMALL");
  });

  it("returns MEDIUM for 2-3 files", () => {
    expect(estimateComplexity(["src/a.ts", "src/b.ts"])).toBe("MEDIUM");
  });

  it("returns LARGE for many files across dirs", () => {
    expect(estimateComplexity([
      "src/a.ts", "lib/b.ts", "tests/c.ts", "config/d.json",
    ])).toBe("LARGE");
  });

  it("returns MEDIUM for many files in same dir", () => {
    expect(estimateComplexity([
      "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts",
    ])).toBe("MEDIUM");
  });
});

describe("splitSubtasks", () => {
  it("returns single task for simple prompt", () => {
    const tasks = splitSubtasks("fix the login bug");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].risk).toBe("🟡 MEDIUM");
  });

  it("splits on 'then'", () => {
    const tasks = splitSubtasks("update the schema then fix the API endpoint");
    expect(tasks.length).toBeGreaterThan(1);
  });

  it("assigns HIGH risk to database/migration tasks", () => {
    const tasks = splitSubtasks("run the database migration then update the API endpoint");
    const dbTask = tasks.find(t => /database/i.test(t.step));
    expect(dbTask?.risk).toBe("🔴 HIGH");
  });

  it("assigns MEDIUM risk to API tasks", () => {
    const tasks = splitSubtasks("update the tests then fix the API endpoint");
    const apiTask = tasks.find(t => /API endpoint/i.test(t.step));
    expect(apiTask?.risk).toBe("🟡 MEDIUM");
  });

  it("assigns LOW risk to generic tasks", () => {
    const tasks = splitSubtasks("update the tests then fix the typo in README");
    const readmeTask = tasks.find(t => /README/i.test(t.step));
    expect(readmeTask?.risk).toBe("🟢 LOW");
  });
});
