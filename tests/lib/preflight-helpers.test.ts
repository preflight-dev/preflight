import { describe, it, expect } from "vitest";
import { extractFilePaths, detectAmbiguity, estimateComplexity, splitSubtasks } from "../../src/lib/preflight-helpers.js";

describe("extractFilePaths", () => {
  it("extracts real file paths", () => {
    expect(extractFilePaths("update src/lib/git.ts and tests/foo.test.ts")).toEqual([
      "src/lib/git.ts",
      "tests/foo.test.ts",
    ]);
  });

  it("filters out version strings", () => {
    expect(extractFilePaths("upgrade to v3.2.0")).toEqual([]);
    expect(extractFilePaths("version 1.0.0 is out")).toEqual([]);
  });

  it("filters out common abbreviations", () => {
    expect(extractFilePaths("e.g. this should work, i.e. correctly")).toEqual([]);
  });

  it("filters out framework names without path context", () => {
    // node.js, next.js etc. are not file paths on their own
    expect(extractFilePaths("use node.js for the backend")).toEqual([]);
  });

  it("keeps paths with slashes even without known extensions", () => {
    expect(extractFilePaths("check config/app.conf")).toEqual(["config/app.conf"]);
  });

  it("deduplicates", () => {
    expect(extractFilePaths("edit foo.ts and then foo.ts again")).toEqual(["foo.ts"]);
  });

  it("handles empty/no-match prompts", () => {
    expect(extractFilePaths("just fix the bug")).toEqual([]);
    expect(extractFilePaths("")).toEqual([]);
  });
});

describe("detectAmbiguity", () => {
  it("flags vague pronouns", () => {
    const issues = detectAmbiguity("fix it and deploy");
    expect(issues.some((i) => i.includes("vague pronouns"))).toBe(true);
  });

  it("flags vague verbs without file targets", () => {
    const issues = detectAmbiguity("refactor the code to be cleaner");
    expect(issues.some((i) => i.includes("Vague verb"))).toBe(true);
  });

  it("does not flag vague verbs when files are referenced", () => {
    const issues = detectAmbiguity("refactor src/lib/git.ts to use async");
    expect(issues.some((i) => i.includes("Vague verb"))).toBe(false);
  });

  it("flags short prompts", () => {
    const issues = detectAmbiguity("fix bug");
    expect(issues.some((i) => i.includes("Very short"))).toBe(true);
  });

  it("returns empty for clear prompts", () => {
    const issues = detectAmbiguity("Add a new endpoint in src/routes/users.ts returning paginated user list with offset and limit params");
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

  it("returns LARGE for many files across dirs", () => {
    expect(estimateComplexity(["src/a.ts", "tests/b.ts", "lib/c.ts", "docs/d.md"])).toBe("LARGE");
  });
});

describe("splitSubtasks", () => {
  it("splits on 'then'", () => {
    const tasks = splitSubtasks("update the schema then run migrations then deploy");
    expect(tasks.length).toBe(3);
  });

  it("assigns risk levels", () => {
    const tasks = splitSubtasks("update the database schema then add an API endpoint then fix the button");
    expect(tasks[0].risk).toBe("🔴 HIGH"); // database/schema
    expect(tasks[1].risk).toBe("🟡 MEDIUM"); // API/endpoint
    expect(tasks[2].risk).toBe("🟢 LOW");
  });

  it("returns single task for simple prompts", () => {
    const tasks = splitSubtasks("add a login page");
    expect(tasks.length).toBe(1);
  });
});
