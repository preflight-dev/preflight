import { describe, it, expect } from "vitest";
import { triagePrompt, type TriageConfig } from "../src/lib/triage.js";

describe("triagePrompt", () => {
  // ── Trivial ────────────────────────────────────────────────────────────

  describe("trivial classification", () => {
    it.each([
      "commit",
      "format",
      "lint",
      "run tests",
      "push",
      "build",
      "test",
    ])('classifies "%s" as trivial', (prompt) => {
      const result = triagePrompt(prompt);
      expect(result.level).toBe("trivial");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("classifies trivial commands with trailing args", () => {
      const result = triagePrompt("commit -m fix");
      expect(result.level).toBe("trivial");
    });

    it("classifies skip keywords as trivial", () => {
      const result = triagePrompt("just deploy it", {
        skip: ["just deploy"],
      });
      expect(result.level).toBe("trivial");
      expect(result.confidence).toBe(0.95);
      expect(result.reasons[0]).toContain("skip keyword");
    });
  });

  // ── Clear ──────────────────────────────────────────────────────────────

  describe("clear classification", () => {
    it("classifies prompts with specific file paths as clear", () => {
      const result = triagePrompt(
        "fix the null check in src/auth/jwt.ts line 42"
      );
      expect(result.level).toBe("clear");
      expect(result.reasons.some((r) => r.includes("file"))).toBe(true);
    });

    it("classifies detailed prompts as clear", () => {
      const result = triagePrompt(
        "Add a try-catch wrapper around the database connection pool initialization in src/db/pool.ts"
      );
      expect(result.level).toBe("clear");
    });

    it("does not flag vague verbs when file refs are present", () => {
      const result = triagePrompt("fix src/lib/triage.ts");
      expect(result.level).toBe("clear");
    });

    it("adjusts confidence down in strict mode", () => {
      const relaxed = triagePrompt(
        "Add error handling to src/server.ts around the listen call"
      );
      const strict = triagePrompt(
        "Add error handling to src/server.ts around the listen call",
        { strictness: "strict" }
      );
      expect(strict.confidence).toBeLessThanOrEqual(relaxed.confidence);
    });
  });

  // ── Ambiguous ──────────────────────────────────────────────────────────

  describe("ambiguous classification", () => {
    it("flags short prompts without file refs", () => {
      const result = triagePrompt("fix the auth bug");
      expect(result.level).toBe("ambiguous");
      expect(result.reasons.some((r) => r.includes("short prompt"))).toBe(
        true
      );
    });

    it("flags vague pronouns", () => {
      const result = triagePrompt(
        "update it so that it handles the edge case better"
      );
      expect(result.level).toBe("ambiguous");
      expect(result.reasons.some((r) => r.includes("vague pronouns"))).toBe(
        true
      );
    });

    it("flags vague verbs without targets", () => {
      const result = triagePrompt("fix the bug");
      expect(result.level).toBe("ambiguous");
    });

    it("flags always_check keywords", () => {
      const result = triagePrompt("update the migration scripts", {
        alwaysCheck: ["migration"],
      });
      expect(result.level).toBe("ambiguous");
      expect(result.reasons[0]).toContain("always_check");
    });

    it("recommends clarify-intent tool", () => {
      const result = triagePrompt("fix the auth bug");
      expect(result.recommended_tools).toContain("clarify-intent");
    });
  });

  // ── Cross-service ──────────────────────────────────────────────────────

  describe("cross-service classification", () => {
    it("detects cross-service keywords", () => {
      const result = triagePrompt("update the rewards API schema", {
        crossServiceKeywords: ["rewards"],
      });
      expect(result.level).toBe("cross-service");
      expect(result.cross_service_hits).toBeDefined();
      expect(result.cross_service_hits!.length).toBeGreaterThan(0);
    });

    it("detects related project aliases", () => {
      const result = triagePrompt("check the payments service for the type", {
        relatedAliases: ["payments"],
      });
      expect(result.level).toBe("cross-service");
      expect(
        result.cross_service_hits!.some((h) => h.includes("payments"))
      ).toBe(true);
    });

    it("detects built-in cross-service terms (schema, contract, etc.)", () => {
      const result = triagePrompt(
        "update the event contract for order processing"
      );
      expect(result.level).toBe("cross-service");
    });
  });

  // ── Multi-step ─────────────────────────────────────────────────────────

  describe("multi-step classification", () => {
    it("detects sequential language (then, after that)", () => {
      const result = triagePrompt(
        "first update the schema, then migrate the database, finally update the API handlers"
      );
      expect(result.level).toBe("multi-step");
    });

    it('detects "and" connecting distinct clauses', () => {
      const result = triagePrompt(
        "refactor the auth module and update all API consumers"
      );
      expect(result.level).toBe("multi-step");
    });

    it("detects numbered lists", () => {
      const result = triagePrompt(
        "Please do:\n1) Update config\n2) Run migrations\n3) Deploy"
      );
      expect(result.level).toBe("multi-step");
    });

    it("detects bullet lists", () => {
      const result = triagePrompt(
        "Tasks:\n- Fix the auth bug\n- Update tests\n- Deploy to staging"
      );
      expect(result.level).toBe("multi-step");
    });

    it("detects files across multiple directories", () => {
      const result = triagePrompt(
        "update src/auth/login.ts and tests/auth/login.test.ts to handle the new token format"
      );
      expect(result.level).toBe("multi-step");
    });

    it("combines multi-step + cross-service for highest complexity", () => {
      const result = triagePrompt(
        "update the rewards schema then sync the payments service contract",
        { crossServiceKeywords: ["rewards"], relatedAliases: ["payments"] }
      );
      expect(result.level).toBe("multi-step");
      expect(result.cross_service_hits!.length).toBeGreaterThan(0);
      expect(result.confidence).toBe(0.9);
    });

    it("recommends sequence-tasks tool", () => {
      const result = triagePrompt(
        "first lint, then run tests, finally deploy"
      );
      expect(result.recommended_tools).toContain("sequence-tasks");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = triagePrompt("");
      expect(result.level).toBeDefined();
    });

    it("handles very long prompts", () => {
      const long = "add error handling to ".repeat(100) + "src/server.ts";
      const result = triagePrompt(long);
      expect(result.level).toBeDefined();
    });

    it("skip keywords take priority over everything", () => {
      // This prompt would normally be multi-step, but skip overrides
      const result = triagePrompt(
        "yolo deploy everything then restart all services",
        { skip: ["yolo"] }
      );
      expect(result.level).toBe("trivial");
    });

    it("works with no config", () => {
      const result = triagePrompt("do something");
      expect(result).toHaveProperty("level");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reasons");
      expect(result).toHaveProperty("recommended_tools");
    });
  });
});
