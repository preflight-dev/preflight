import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// We need to mock fs and the PROJECT_DIR before importing config
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/fake/project",
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    // Clean env vars
    delete process.env.PROMPT_DISCIPLINE_PROFILE;
    delete process.env.PREFLIGHT_RELATED;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  async function loadFreshConfig() {
    // Re-import to reset the singleton
    const mod = await import("../../src/lib/config.js");
    return mod;
  }

  describe("getConfig", () => {
    it("returns default config when no .preflight/ dir and no env vars", async () => {
      mockedExistsSync.mockReturnValue(false);
      const { getConfig } = await loadFreshConfig();
      const config = getConfig();

      expect(config.profile).toBe("standard");
      expect(config.related_projects).toEqual([]);
      expect(config.thresholds.session_stale_minutes).toBe(30);
      expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
      expect(config.thresholds.correction_pattern_threshold).toBe(3);
      expect(config.embeddings.provider).toBe("local");
      expect(config.triage.strictness).toBe("standard");
      expect(config.triage.rules.always_check).toContain("rewards");
      expect(config.triage.rules.skip).toContain("lint");
    });

    it("returns cached config on second call (singleton)", async () => {
      mockedExistsSync.mockReturnValue(false);
      const { getConfig } = await loadFreshConfig();
      const first = getConfig();
      const second = getConfig();
      expect(first).toBe(second); // Same reference
    });

    it("reads config.yml when .preflight/ dir exists", async () => {
      const configYml = `
profile: full
related_projects:
  - path: /other/repo
    alias: other
thresholds:
  session_stale_minutes: 60
embeddings:
  provider: openai
`;
      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        if (s.endsWith("config.yml")) return true;
        return false;
      });
      mockedReadFileSync.mockReturnValue(configYml);

      const { getConfig } = await loadFreshConfig();
      const config = getConfig();

      expect(config.profile).toBe("full");
      expect(config.related_projects).toEqual([{ path: "/other/repo", alias: "other" }]);
      expect(config.thresholds.session_stale_minutes).toBe(60);
      // Non-overridden thresholds keep defaults
      expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
      expect(config.embeddings.provider).toBe("openai");
    });

    it("reads triage.yml when present", async () => {
      const triageYml = `
rules:
  always_check:
    - payments
    - auth
strictness: strict
`;
      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        if (s.endsWith("config.yml")) return false;
        if (s.endsWith("triage.yml")) return true;
        return false;
      });
      mockedReadFileSync.mockReturnValue(triageYml);

      const { getConfig } = await loadFreshConfig();
      const config = getConfig();

      expect(config.triage.strictness).toBe("strict");
      expect(config.triage.rules.always_check).toEqual(["payments", "auth"]);
    });

    it("warns and uses defaults on invalid config.yml", async () => {
      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        if (s.endsWith("config.yml")) return true;
        return false;
      });
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { getConfig } = await loadFreshConfig();
      const config = getConfig();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("failed to parse"));
      expect(config.profile).toBe("standard"); // Falls back to default
      warnSpy.mockRestore();
    });

    it("applies env var overrides when no .preflight/ dir", async () => {
      mockedExistsSync.mockReturnValue(false);
      process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";
      process.env.PREFLIGHT_RELATED = "/proj/a, /proj/b";
      process.env.EMBEDDING_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "sk-test123";

      const { getConfig } = await loadFreshConfig();
      const config = getConfig();

      expect(config.profile).toBe("minimal");
      expect(config.related_projects).toHaveLength(2);
      expect(config.related_projects[0].path).toBe("/proj/a");
      expect(config.related_projects[0].alias).toBe("a");
      expect(config.related_projects[1].path).toBe("/proj/b");
      expect(config.related_projects[1].alias).toBe("b");
      expect(config.embeddings.provider).toBe("openai");
      expect(config.embeddings.openai_api_key).toBe("sk-test123");
    });

    it("ignores invalid env profile values", async () => {
      mockedExistsSync.mockReturnValue(false);
      process.env.PROMPT_DISCIPLINE_PROFILE = "turbo";

      const { getConfig } = await loadFreshConfig();
      const config = getConfig();

      expect(config.profile).toBe("standard"); // Default, not "turbo"
    });

    it("ignores env vars when .preflight/ dir exists", async () => {
      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        return false;
      });
      process.env.PROMPT_DISCIPLINE_PROFILE = "full";

      const { getConfig } = await loadFreshConfig();
      const config = getConfig();

      expect(config.profile).toBe("standard"); // .preflight exists but no config.yml, so default
    });

    it("handles empty YAML document gracefully", async () => {
      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        if (s.endsWith("config.yml")) return true;
        return false;
      });
      mockedReadFileSync.mockReturnValue(""); // Empty YAML

      const { getConfig } = await loadFreshConfig();
      const config = getConfig();

      expect(config.profile).toBe("standard"); // Defaults preserved
    });
  });

  describe("getRelatedProjects", () => {
    it("returns paths from related_projects config", async () => {
      const configYml = `
related_projects:
  - path: /a
    alias: a
  - path: /b
    alias: b
`;
      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".preflight")) return true;
        if (s.endsWith("config.yml")) return true;
        return false;
      });
      mockedReadFileSync.mockReturnValue(configYml);

      const { getRelatedProjects } = await loadFreshConfig();
      expect(getRelatedProjects()).toEqual(["/a", "/b"]);
    });

    it("returns empty array when no related projects", async () => {
      mockedExistsSync.mockReturnValue(false);
      const { getRelatedProjects } = await loadFreshConfig();
      expect(getRelatedProjects()).toEqual([]);
    });
  });

  describe("hasPreflightConfig", () => {
    it("returns true when .preflight/ exists", async () => {
      mockedExistsSync.mockImplementation((p) => {
        return String(p).endsWith(".preflight");
      });
      const { hasPreflightConfig } = await loadFreshConfig();
      expect(hasPreflightConfig()).toBe(true);
    });

    it("returns false when .preflight/ does not exist", async () => {
      mockedExistsSync.mockReturnValue(false);
      const { hasPreflightConfig } = await loadFreshConfig();
      expect(hasPreflightConfig()).toBe(false);
    });
  });
});
