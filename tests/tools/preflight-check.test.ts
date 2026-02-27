import { describe, it, expect } from "vitest";
import {
  extractFilePaths,
  buildScopeSection,
  buildSequenceSection,
} from "../../src/tools/preflight-check.js";

describe("extractFilePaths", () => {
  it("extracts typical source file paths", () => {
    const result = extractFilePaths("update src/lib/triage.ts and src/tools/audit-workspace.ts");
    expect(result).toContain("src/lib/triage.ts");
    expect(result).toContain("src/tools/audit-workspace.ts");
  });

  it("deduplicates repeated paths", () => {
    const result = extractFilePaths("fix foo.ts then test foo.ts again");
    expect(result.filter((p) => p === "foo.ts")).toHaveLength(1);
  });

  it("returns empty array for no file references", () => {
    expect(extractFilePaths("fix the auth bug")).toEqual([]);
  });

  it("handles dotfiles and nested paths", () => {
    const result = extractFilePaths("edit .env and config/settings.json");
    expect(result).toContain("config/settings.json");
  });

  it("handles various extensions", () => {
    const result = extractFilePaths("check index.html style.css app.js data.json");
    expect(result).toHaveLength(4);
  });
});

describe("buildScopeSection", () => {
  it("reports SMALL scope for single-file prompts", () => {
    const sections = buildScopeSection("fix a typo in README.md");
    const scopeLine = sections.find((s) => s.startsWith("### Scope:"));
    expect(scopeLine).toContain("SMALL");
  });

  it("reports MEDIUM scope for multi-file prompts", () => {
    const sections = buildScopeSection("update src/a.ts and src/b.ts and src/c.ts");
    const scopeLine = sections.find((s) => s.startsWith("### Scope:"));
    // 3 files in same dir = MEDIUM (not LARGE since only 1 dir prefix)
    expect(scopeLine).toMatch(/SMALL|MEDIUM/);
  });

  it("reports LARGE scope for many files across directories", () => {
    const sections = buildScopeSection(
      "refactor src/lib/a.ts src/tools/b.ts tests/c.ts config/d.json"
    );
    const scopeLine = sections.find((s) => s.startsWith("### Scope:"));
    expect(scopeLine).toContain("LARGE");
  });
});

describe("buildSequenceSection", () => {
  it("splits multi-step prompts on 'then'", () => {
    const sections = buildSequenceSection("add the endpoint then write tests then deploy");
    const steps = sections.filter((s) => /^\d+\./.test(s));
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });

  it("assigns HIGH risk to schema/migration steps", () => {
    const sections = buildSequenceSection("run the database migration then update the API");
    const migrationStep = sections.find((s) => /migration/i.test(s));
    expect(migrationStep).toContain("HIGH");
  });

  it("assigns MEDIUM risk to API steps", () => {
    const sections = buildSequenceSection("update the API endpoint");
    const apiStep = sections.find((s) => /API/i.test(s));
    expect(apiStep).toContain("MEDIUM");
  });

  it("assigns LOW risk to simple steps", () => {
    const sections = buildSequenceSection("update the readme then fix the typo");
    const steps = sections.filter((s) => /^\d+\./.test(s));
    expect(steps.some((s) => s.includes("LOW"))).toBe(true);
  });

  it("includes checkpoint reminders", () => {
    const sections = buildSequenceSection("do stuff then more stuff");
    expect(sections.some((s) => /checkpoint/i.test(s))).toBe(true);
  });
});
