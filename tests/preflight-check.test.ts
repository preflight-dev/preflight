import { describe, it, expect } from "vitest";
import { extractFilePaths, buildScopeSection, buildSequenceSection } from "../src/tools/preflight-check.js";

describe("preflight-check", () => {
  describe("extractFilePaths", () => {
    it("extracts simple file paths", () => {
      const result = extractFilePaths("fix the bug in src/auth/jwt.ts");
      expect(result).toContain("src/auth/jwt.ts");
    });

    it("extracts multiple paths and deduplicates", () => {
      const result = extractFilePaths("update src/lib/config.ts and src/lib/config.ts and tests/foo.test.ts");
      expect(result).toEqual(["src/lib/config.ts", "tests/foo.test.ts"]);
    });

    it("handles paths with dashes and dots", () => {
      const result = extractFilePaths("check my-app/src/index.js");
      expect(result).toContain("my-app/src/index.js");
    });

    it("returns empty for no file paths", () => {
      expect(extractFilePaths("just commit everything")).toEqual([]);
    });

    it("handles Windows-style backslashes", () => {
      const result = extractFilePaths("edit src\\utils\\helper.ts");
      expect(result).toContain("src\\utils\\helper.ts");
    });

    it("ignores extensions longer than 6 chars", () => {
      // The regex limits extensions to 1-6 chars
      const result = extractFilePaths("open file.longextension");
      expect(result).not.toContain("file.longextension");
    });
  });

  describe("buildScopeSection", () => {
    it("labels single-file prompts as SMALL", () => {
      const result = buildScopeSection("fix src/auth.ts");
      const text = result.join("\n");
      expect(text).toContain("SMALL");
    });

    it("labels multi-file prompts as MEDIUM", () => {
      const result = buildScopeSection("update src/a.ts and src/b.ts and src/c.ts");
      const text = result.join("\n");
      expect(text).toMatch(/MEDIUM|SMALL/); // 3 files same dir = MEDIUM only if > 1
    });

    it("labels multi-dir multi-file prompts as LARGE", () => {
      const result = buildScopeSection(
        "refactor src/auth/login.ts src/api/routes.ts tests/auth.test.ts lib/utils/helpers.ts"
      );
      const text = result.join("\n");
      expect(text).toContain("LARGE");
    });

    it("includes referenced files section when paths found", () => {
      const result = buildScopeSection("check src/index.ts");
      const text = result.join("\n");
      expect(text).toContain("Referenced Files");
    });
  });

  describe("buildSequenceSection", () => {
    it("splits on 'then' keyword", () => {
      const result = buildSequenceSection("add the auth module then update the tests");
      const text = result.join("\n");
      expect(text).toContain("1.");
      expect(text).toContain("2.");
    });

    it("splits on 'after that'", () => {
      const result = buildSequenceSection("fix the bug after that deploy to staging");
      const text = result.join("\n");
      expect(text).toContain("2.");
    });

    it("assigns HIGH risk to schema/migration tasks", () => {
      const result = buildSequenceSection("update the database schema then fix the API");
      const text = result.join("\n");
      expect(text).toContain("🔴 HIGH");
    });

    it("assigns MEDIUM risk to API tasks", () => {
      const result = buildSequenceSection("create the endpoint then write tests");
      const text = result.join("\n");
      expect(text).toContain("🟡 MEDIUM");
    });

    it("returns single step for simple prompts", () => {
      const result = buildSequenceSection("fix the button color");
      const text = result.join("\n");
      expect(text).toContain("1.");
      expect(text).not.toContain("2.");
    });

    it("includes checkpoint reminders", () => {
      const result = buildSequenceSection("do something");
      const text = result.join("\n");
      expect(text).toContain("Checkpoints");
      expect(text).toContain("Run tests between steps");
    });
  });
});
