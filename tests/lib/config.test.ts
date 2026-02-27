import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getConfig, getRelatedProjects, hasPreflightConfig, resetConfig } from "../../src/lib/config.js";
import * as fs from "fs";
import * as path from "path";

// Mock fs and files module to control config loading
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof fs>("fs");
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

describe("config", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
    vi.clearAllMocks();
    // Default: no .preflight/ dir
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = { ...origEnv };
    resetConfig();
  });

  describe("getConfig defaults", () => {
    it("returns default config when no .preflight/ and no env vars", () => {
      delete process.env.PROMPT_DISCIPLINE_PROFILE;
      delete process.env.PREFLIGHT_RELATED;
      delete process.env.EMBEDDING_PROVIDER;
      delete process.env.OPENAI_API_KEY;

      const config = getConfig();
      expect(config.profile).toBe("standard");
      expect(config.related_projects).toEqual([]);
      expect(config.thresholds.session_stale_minutes).toBe(30);
      expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
      expect(config.thresholds.correction_pattern_threshold).toBe(3);
      expect(config.embeddings.provider).toBe("local");
      expect(config.triage.strictness).toBe("standard");
      expect(config.triage.rules.always_check).toContain("rewards");
      expect(config.triage.rules.skip).toContain("commit");
    });

    it("caches config on repeated calls", () => {
      delete process.env.PROMPT_DISCIPLINE_PROFILE;
      const c1 = getConfig();
      const c2 = getConfig();
      expect(c1).toBe(c2); // same reference
    });

    it("resetConfig clears the cache", () => {
      delete process.env.PROMPT_DISCIPLINE_PROFILE;
      const c1 = getConfig();
      resetConfig();
      const c2 = getConfig();
      expect(c1).not.toBe(c2); // different reference
      expect(c1).toEqual(c2); // same values
    });
  });

  describe("env var overrides (no .preflight/)", () => {
    it("reads PROMPT_DISCIPLINE_PROFILE", () => {
      process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";
      const config = getConfig();
      expect(config.profile).toBe("minimal");
    });

    it("reads PROMPT_DISCIPLINE_PROFILE=full", () => {
      process.env.PROMPT_DISCIPLINE_PROFILE = "full";
      const config = getConfig();
      expect(config.profile).toBe("full");
    });

    it("ignores invalid PROMPT_DISCIPLINE_PROFILE", () => {
      process.env.PROMPT_DISCIPLINE_PROFILE = "turbo";
      const config = getConfig();
      expect(config.profile).toBe("standard");
    });

    it("reads PREFLIGHT_RELATED", () => {
      process.env.PREFLIGHT_RELATED = "/tmp/project-a, /tmp/project-b";
      const config = getConfig();
      expect(config.related_projects).toHaveLength(2);
      expect(config.related_projects[0]).toEqual({ path: "/tmp/project-a", alias: "project-a" });
      expect(config.related_projects[1]).toEqual({ path: "/tmp/project-b", alias: "project-b" });
    });

    it("reads EMBEDDING_PROVIDER", () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      const config = getConfig();
      expect(config.embeddings.provider).toBe("openai");
    });

    it("reads OPENAI_API_KEY", () => {
      process.env.OPENAI_API_KEY = "sk-test-123";
      const config = getConfig();
      expect(config.embeddings.openai_api_key).toBe("sk-test-123");
    });
  });

  describe(".preflight/ config loading", () => {
    it("loads config.yml when .preflight/ exists", () => {
      const configYaml = `
profile: full
related_projects:
  - path: /tmp/svc-a
    alias: svc-a
thresholds:
  session_stale_minutes: 60
embeddings:
  provider: openai
`;
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        if (s.endsWith("config.yml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: any, _enc?: any) => {
        if (String(p).endsWith("config.yml")) return configYaml;
        throw new Error("not found");
      });

      const config = getConfig();
      expect(config.profile).toBe("full");
      expect(config.related_projects).toEqual([{ path: "/tmp/svc-a", alias: "svc-a" }]);
      expect(config.thresholds.session_stale_minutes).toBe(60);
      // Other thresholds keep defaults
      expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
      expect(config.embeddings.provider).toBe("openai");
    });

    it("loads triage.yml when present", () => {
      const triageYaml = `
rules:
  always_check:
    - payments
    - billing
  skip:
    - deploy
strictness: strict
`;
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        if (s.endsWith("triage.yml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: any, _enc?: any) => {
        if (String(p).endsWith("triage.yml")) return triageYaml;
        throw new Error("not found");
      });

      const config = getConfig();
      expect(config.triage.strictness).toBe("strict");
      expect(config.triage.rules.always_check).toEqual(["payments", "billing"]);
      expect(config.triage.rules.skip).toEqual(["deploy"]);
    });

    it("ignores env vars when .preflight/ exists", () => {
      process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        return false;
      });

      const config = getConfig();
      // Should use default "standard", not env "minimal"
      expect(config.profile).toBe("standard");
    });

    it("handles malformed config.yml gracefully", () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        if (s.endsWith("config.yml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: any, _enc?: any) => {
        if (String(p).endsWith("config.yml")) return "{{invalid yaml: [";
        throw new Error("not found");
      });

      // Should not throw, falls back to defaults
      const config = getConfig();
      expect(config.profile).toBe("standard");
    });
  });

  describe("getRelatedProjects", () => {
    it("returns paths from config", () => {
      process.env.PREFLIGHT_RELATED = "/tmp/a, /tmp/b";
      const projects = getRelatedProjects();
      expect(projects).toEqual(["/tmp/a", "/tmp/b"]);
    });

    it("returns empty array by default", () => {
      delete process.env.PREFLIGHT_RELATED;
      expect(getRelatedProjects()).toEqual([]);
    });
  });

  describe("hasPreflightConfig", () => {
    it("returns true when .preflight/ exists", () => {
      mockExistsSync.mockImplementation((p: any) => String(p).endsWith(".preflight"));
      expect(hasPreflightConfig()).toBe(true);
    });

    it("returns false when .preflight/ missing", () => {
      mockExistsSync.mockReturnValue(false);
      expect(hasPreflightConfig()).toBe(false);
    });
  });
});
