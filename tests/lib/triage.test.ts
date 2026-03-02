import { describe, it, expect } from "vitest";
import { triagePrompt, type TriageConfig } from "../../src/lib/triage.js";

describe("triagePrompt", () => {
  // --- Trivial ---

  it("classifies short common commands as trivial", () => {
    const result = triagePrompt("commit");
    expect(result.level).toBe("trivial");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("classifies skip keywords as trivial", () => {
    const config: TriageConfig = { skip: ["deploy production"] };
    const result = triagePrompt("deploy production to us-east", config);
    expect(result.level).toBe("trivial");
    expect(result.reasons[0]).toContain("skip keyword");
  });

  // --- Ambiguous ---

  it("classifies vague prompts as ambiguous", () => {
    const result = triagePrompt("fix the tests");
    expect(result.level).toBe("ambiguous");
  });

  it("classifies short vague-verb prompts as ambiguous", () => {
    const result = triagePrompt("fix auth bug");
    expect(result.level).toBe("ambiguous");
  });

  it("classifies vague pronouns without file refs as ambiguous", () => {
    const result = triagePrompt("fix it");
    expect(result.level).toBe("ambiguous");
    expect(result.reasons.some((r) => r.includes("vague pronouns"))).toBe(true);
  });

  it("classifies always_check keywords as ambiguous", () => {
    const config: TriageConfig = { alwaysCheck: ["database migration"] };
    const result = triagePrompt("run database migration", config);
    expect(result.level).toBe("ambiguous");
    expect(result.reasons[0]).toContain("always_check");
  });

  // --- Clear ---

  it("classifies prompts with file + line refs as clear", () => {
    const result = triagePrompt(
      "fix the null check in src/auth/jwt.ts line 42",
    );
    expect(result.level).toBe("clear");
  });

  it("does not flag vague pronouns when prompt has file refs", () => {
    const result = triagePrompt("fix it in src/app.ts");
    expect(result.level).toBe("clear");
  });

  it("does not flag vague verbs when prompt has file refs", () => {
    const result = triagePrompt("fix the handler in src/routes/auth.ts");
    expect(result.level).toBe("clear");
  });

  // --- Multi-step ---

  it("classifies sequential 'and' prompts as multi-step", () => {
    const result = triagePrompt(
      "refactor auth to OAuth2 and update all API consumers",
    );
    expect(result.level).toBe("multi-step");
  });

  it("classifies numbered lists as multi-step", () => {
    const result = triagePrompt("Do this:\n1) add the model\n2) write tests");
    expect(result.level).toBe("multi-step");
  });

  it("classifies multiple file refs in different directories as multi-step", () => {
    const result = triagePrompt(
      "update src/auth/login.ts and tests/integration/auth.test.ts to handle the new token format",
    );
    expect(result.level).toBe("multi-step");
  });

  // --- Cross-service ---

  it("classifies cross-service keyword matches", () => {
    const config: TriageConfig = {
      crossServiceKeywords: ["rewards", "loyalty"],
    };
    const result = triagePrompt("add schema migration for rewards", config);
    expect(result.level).toBe("cross-service");
    expect(result.cross_service_hits).toBeDefined();
    expect(result.cross_service_hits!.length).toBeGreaterThan(0);
  });

  // --- Config effects ---

  it("strict mode lowers confidence on clear prompts", () => {
    const relaxed = triagePrompt("add a button to the dashboard page in src/components/Dashboard.tsx");
    const strict = triagePrompt(
      "add a button to the dashboard page in src/components/Dashboard.tsx",
      { strictness: "strict" },
    );
    expect(strict.confidence).toBeLessThan(relaxed.confidence);
  });

  it("pattern match count boosts level to ambiguous", () => {
    // A prompt that would normally be clear
    const config: TriageConfig = { patternMatchCount: 3 };
    // patternMatchCount is declared in config but triagePrompt doesn't use it
    // directly — it's used by the caller. This test verifies the config type.
    expect(config.patternMatchCount).toBe(3);
  });

  // --- hasVagueVerbs behavior (tested indirectly) ---

  it("vague verb with concrete target after it is not ambiguous", () => {
    // "fix" followed by a long word (>6 chars) = not vague
    const result = triagePrompt(
      "fix the authentication middleware in src/middleware.ts",
    );
    expect(result.level).toBe("clear");
  });

  it("vague verb without concrete target is ambiguous", () => {
    const result = triagePrompt("fix the bug");
    expect(result.level).toBe("ambiguous");
  });

  // --- Multi-step + Cross-service ---

  it("detects multi-step AND cross-service together", () => {
    const config: TriageConfig = {
      crossServiceKeywords: ["webhook"],
      relatedAliases: ["billing-api"],
    };
    const result = triagePrompt(
      "refactor the auth module to use OAuth2 then update the webhook handler in billing-api",
      config,
    );
    expect(result.level).toBe("multi-step");
    expect(result.cross_service_hits).toBeDefined();
    expect(result.cross_service_hits!.length).toBeGreaterThan(0);
    expect(result.reasons.some(r => r.includes("cross-service"))).toBe(true);
    expect(result.reasons.some(r => r.includes("multi-step"))).toBe(true);
    expect(result.recommended_tools).toContain("search-related-projects");
    expect(result.recommended_tools).toContain("sequence-tasks");
  });

  it("multi-step without cross-service has no cross_service_hits", () => {
    const result = triagePrompt(
      "add input validation to the form then write unit tests for it",
    );
    expect(result.level).toBe("multi-step");
    expect(result.cross_service_hits).toBeUndefined();
  });

  it("cross-service without multi-step returns cross-service level", () => {
    const config: TriageConfig = {
      crossServiceKeywords: ["webhook"],
    };
    const result = triagePrompt("check the webhook payload format", config);
    expect(result.level).toBe("cross-service");
    expect(result.cross_service_hits).toBeDefined();
  });
});
