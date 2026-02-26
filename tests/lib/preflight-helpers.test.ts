import { describe, it, expect } from "vitest";
import {
  extractFilePaths,
  detectAmbiguity,
  estimateComplexity,
  classifyRisk,
  splitSubtasks,
} from "../../src/lib/preflight-helpers.js";

// ---------------------------------------------------------------------------
// extractFilePaths
// ---------------------------------------------------------------------------
describe("extractFilePaths", () => {
  it("extracts simple file paths", () => {
    expect(extractFilePaths("fix the bug in src/index.ts")).toContain("src/index.ts");
  });

  it("extracts multiple unique paths", () => {
    const result = extractFilePaths("update src/a.ts and src/b.ts, also src/a.ts again");
    expect(result).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns empty for no file paths", () => {
    expect(extractFilePaths("just do the thing")).toEqual([]);
  });

  it("handles nested paths", () => {
    const result = extractFilePaths("edit src/lib/config.ts");
    expect(result).toContain("src/lib/config.ts");
  });

  it("handles windows-style paths", () => {
    const result = extractFilePaths("check src\\utils\\helper.js");
    expect(result).toContain("src\\utils\\helper.js");
  });
});

// ---------------------------------------------------------------------------
// detectAmbiguity
// ---------------------------------------------------------------------------
describe("detectAmbiguity", () => {
  it("flags vague pronouns", () => {
    const issues = detectAmbiguity("fix it please", []);
    expect(issues.some(i => /vague pronoun/i.test(i))).toBe(true);
  });

  it("flags vague verbs without file targets", () => {
    const issues = detectAmbiguity("refactor the authentication module to be cleaner", []);
    expect(issues.some(i => /vague verb/i.test(i))).toBe(true);
  });

  it("does NOT flag vague verbs when files are present", () => {
    const issues = detectAmbiguity("refactor the authentication module", ["src/auth.ts"]);
    expect(issues.some(i => /vague verb/i.test(i))).toBe(false);
  });

  it("flags very short prompts", () => {
    const issues = detectAmbiguity("fix bug", []);
    expect(issues.some(i => /short prompt/i.test(i))).toBe(true);
  });

  it("returns empty for clear prompts", () => {
    const issues = detectAmbiguity(
      "Add a new endpoint in src/routes/users.ts returning paginated results from the users table",
      ["src/routes/users.ts"]
    );
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// estimateComplexity
// ---------------------------------------------------------------------------
describe("estimateComplexity", () => {
  it("returns SMALL for 0-1 files", () => {
    expect(estimateComplexity([])).toBe("SMALL");
    expect(estimateComplexity(["src/a.ts"])).toBe("SMALL");
  });

  it("returns MEDIUM for 2-3 files", () => {
    expect(estimateComplexity(["src/a.ts", "src/b.ts"])).toBe("MEDIUM");
  });

  it("returns LARGE for 4+ files across 3+ dirs", () => {
    expect(estimateComplexity([
      "src/a.ts", "lib/b.ts", "tests/c.ts", "config/d.yml"
    ])).toBe("LARGE");
  });

  it("returns MEDIUM for many files in few dirs", () => {
    expect(estimateComplexity([
      "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"
    ])).toBe("MEDIUM");
  });
});

// ---------------------------------------------------------------------------
// classifyRisk
// ---------------------------------------------------------------------------
describe("classifyRisk", () => {
  it("returns HIGH for schema/migration/deploy keywords", () => {
    expect(classifyRisk("run the database migration")).toBe("🔴 HIGH");
    expect(classifyRisk("update the schema")).toBe("🔴 HIGH");
    expect(classifyRisk("deploy to production")).toBe("🔴 HIGH");
    expect(classifyRisk("change env variables")).toBe("🔴 HIGH");
  });

  it("returns MEDIUM for API/route keywords", () => {
    expect(classifyRisk("add a new API endpoint")).toBe("🟡 MEDIUM");
    expect(classifyRisk("update the route handler")).toBe("🟡 MEDIUM");
  });

  it("returns LOW for general tasks", () => {
    expect(classifyRisk("add unit tests for the parser")).toBe("🟢 LOW");
    expect(classifyRisk("rename the variable")).toBe("🟢 LOW");
  });
});

// ---------------------------------------------------------------------------
// splitSubtasks
// ---------------------------------------------------------------------------
describe("splitSubtasks", () => {
  it("splits on 'then'", () => {
    const parts = splitSubtasks("update the schema then run the migrations");
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain("schema");
    expect(parts[1]).toContain("migration");
  });

  it("splits on 'after that'", () => {
    const parts = splitSubtasks("create the model after that add the controller");
    expect(parts.length).toBe(2);
  });

  it("splits on 'and add/update/etc'", () => {
    const parts = splitSubtasks("fix the login bug and add error handling for the signup flow");
    expect(parts.length).toBe(2);
  });

  it("returns single-element array for simple prompts", () => {
    const parts = splitSubtasks("fix the login bug in auth.ts");
    expect(parts.length).toBe(1);
    expect(parts[0]).toContain("fix the login bug");
  });

  it("handles multiple splits", () => {
    const parts = splitSubtasks("create the table then add the API endpoint then deploy");
    expect(parts.length).toBe(3);
  });
});
