import { describe, it, expect } from "vitest";
import { triagePrompt, type TriageResult } from "../src/lib/triage.js";

// Helper
const triage = (prompt: string, config?: Parameters<typeof triagePrompt>[1]) =>
  triagePrompt(prompt, config);

describe("triagePrompt", () => {
  // ── Trivial ────────────────────────────────────────────────────────────

  describe("trivial classification", () => {
    it.each([
      "commit",
      "lint",
      "run tests",
      "push",
      "build",
      "format",
      "test",
    ])("classifies '%s' as trivial", (prompt) => {
      expect(triage(prompt).level).toBe("trivial");
    });

    it("classifies short commands with args as trivial", () => {
      expect(triage("commit -m fix typo").level).toBe("trivial");
    });

    it("returns high confidence for trivial", () => {
      expect(triage("commit").confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("returns empty recommended_tools for trivial", () => {
      expect(triage("commit").recommended_tools).toEqual([]);
    });
  });

  // ── Skip keywords ─────────────────────────────────────────────────────

  describe("skip keywords", () => {
    it("returns trivial when prompt matches a skip keyword", () => {
      const result = triage("please deploy now", { skip: ["deploy"] });
      expect(result.level).toBe("trivial");
      expect(result.confidence).toBe(0.95);
    });

    it("is case-insensitive for skip keywords", () => {
      expect(triage("DEPLOY", { skip: ["deploy"] }).level).toBe("trivial");
    });
  });

  // ── Clear ──────────────────────────────────────────────────────────────

  describe("clear classification", () => {
    it("classifies prompt with file path as clear", () => {
      const result = triage("fix the null check in src/auth/jwt.ts line 42");
      expect(result.level).toBe("clear");
    });

    it("classifies detailed prompt with file refs as clear", () => {
      const result = triage(
        "add error handling to the parseToken function in src/auth/jwt.ts"
      );
      expect(result.level).toBe("clear");
    });

    it("includes verify-files-exist when file refs present", () => {
      const result = triage("refactor src/auth/jwt.ts to use async/await");
      expect(result.recommended_tools).toContain("verify-files-exist");
    });

    it("adjusts confidence down in strict mode", () => {
      const relaxed = triage("update src/auth/jwt.ts exports", {
        strictness: "standard",
      });
      const strict = triage("update src/auth/jwt.ts exports", {
        strictness: "strict",
      });
      expect(strict.confidence).toBeLessThanOrEqual(relaxed.confidence);
    });
  });

  // ── Ambiguous ──────────────────────────────────────────────────────────

  describe("ambiguous classification", () => {
    it("classifies short vague prompt as ambiguous", () => {
      expect(triage("fix the auth bug").level).toBe("ambiguous");
    });

    it("classifies prompt with vague pronouns as ambiguous", () => {
      const result = triage("fix it");
      expect(result.level).toBe("ambiguous");
      expect(result.reasons.some((r) => r.includes("vague"))).toBe(true);
    });

    it("classifies vague verbs without targets as ambiguous", () => {
      expect(triage("update the code").level).toBe("ambiguous");
    });

    it("does NOT flag vague verbs when file refs are present", () => {
      const result = triage("fix src/auth/jwt.ts");
      expect(result.level).not.toBe("ambiguous");
    });

    it("recommends clarify-intent for ambiguous", () => {
      const result = triage("fix the auth bug");
      expect(result.recommended_tools).toContain("clarify-intent");
    });
  });

  // ── always_check keywords ─────────────────────────────────────────────

  describe("always_check keywords", () => {
    it("forces at least ambiguous for always_check keywords", () => {
      const result = triage("update the migration scripts", {
        alwaysCheck: ["migration"],
      });
      expect(result.level).toBe("ambiguous");
    });

    it("is case-insensitive", () => {
      const result = triage("run MIGRATION", { alwaysCheck: ["migration"] });
      expect(result.level).toBe("ambiguous");
    });
  });

  // ── Cross-service ──────────────────────────────────────────────────────

  describe("cross-service classification", () => {
    it("detects cross-service keywords", () => {
      const result = triage("update the shared schema for auth", {
        crossServiceKeywords: ["shared schema"],
      });
      expect(result.level).toBe("cross-service");
      expect(result.cross_service_hits).toBeDefined();
    });

    it("detects related project aliases", () => {
      const result = triage("add tiered rewards from rewards-api", {
        relatedAliases: ["rewards-api"],
      });
      expect(result.level).toBe("cross-service");
    });

    it("detects built-in cross-service terms", () => {
      const result = triage(
        "update the user interface contract definition for the billing module"
      );
      expect(result.level).toBe("cross-service");
    });

    it("recommends search-related-projects", () => {
      const result = triage("check the event schema", {
        crossServiceKeywords: ["event schema"],
      });
      expect(result.recommended_tools).toContain("search-related-projects");
    });
  });

  // ── Multi-step ─────────────────────────────────────────────────────────

  describe("multi-step classification", () => {
    it("detects sequential language (then)", () => {
      const result = triage(
        "refactor auth to OAuth2 then update all API consumers"
      );
      expect(result.level).toBe("multi-step");
    });

    it("detects 'first...then' patterns", () => {
      expect(
        triage("first update the schema, then regenerate the types").level
      ).toBe("multi-step");
    });

    it("detects numbered lists", () => {
      const result = triage("todo:\n1) update schema\n2) run migration\n3) test");
      expect(result.level).toBe("multi-step");
    });

    it("detects bullet lists", () => {
      const result = triage("please do:\n- update auth\n- fix tests\n- deploy");
      expect(result.level).toBe("multi-step");
    });

    it("detects files in different directories", () => {
      const result = triage(
        "update src/auth/jwt.ts and tests/auth/jwt.test.ts with the new token format"
      );
      expect(result.level).toBe("multi-step");
    });

    it("recommends sequence-tasks for multi-step", () => {
      const result = triage("first do X then do Y");
      expect(result.recommended_tools).toContain("sequence-tasks");
    });
  });

  // ── Priority ordering ─────────────────────────────────────────────────

  describe("classification priority", () => {
    it("skip keyword beats everything", () => {
      // This would otherwise be multi-step
      const result = triage("deploy first then restart", { skip: ["deploy"] });
      expect(result.level).toBe("trivial");
    });

    it("multi-step beats cross-service", () => {
      // Has both cross-service terms and multi-step indicators
      const result = triage(
        "update the schema definition then update all API consumers",
        { crossServiceKeywords: ["schema"] }
      );
      expect(result.level).toBe("multi-step");
    });

    it("cross-service beats ambiguous", () => {
      const result = triage("fix it in the schema", {
        crossServiceKeywords: ["schema"],
      });
      // "fix it" is vague but "schema" is cross-service keyword
      expect(result.level).toBe("cross-service");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty prompt", () => {
      const result = triage("");
      expect(result.level).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("handles very long prompt", () => {
      const long = "update the authentication module ".repeat(100);
      const result = triage(long);
      expect(result.level).toBeDefined();
    });

    it("handles no config", () => {
      const result = triagePrompt("fix the auth bug");
      expect(result.level).toBeDefined();
    });

    it("returns valid TriageResult shape", () => {
      const result = triage("do something");
      expect(result).toHaveProperty("level");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reasons");
      expect(result).toHaveProperty("recommended_tools");
      expect(Array.isArray(result.reasons)).toBe(true);
      expect(Array.isArray(result.recommended_tools)).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });
});
