import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs and files before importing config
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/tmp/test-project",
}));

import { existsSync, readFileSync } from "fs";
import { getConfig, hasPreflightConfig, getRelatedProjects } from "../../src/lib/config.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("config", () => {
  beforeEach(() => {
    // Reset the cached config singleton between tests
    // Access the module's internal state by re-importing
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe("getConfig — defaults", () => {
    it("returns default config when no .preflight/ exists and no env vars", async () => {
      // Re-import to get fresh singleton
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn(),
      }));
      vi.doMock("../../src/lib/files.js", () => ({
        PROJECT_DIR: "/tmp/test-project",
      }));

      const { getConfig } = await import("../../src/lib/config.js");
      const config = getConfig();

      expect(config.profile).toBe("standard");
      expect(config.related_projects).toEqual([]);
      expect(config.thresholds.session_stale_minutes).toBe(30);
      expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
      expect(config.embeddings.provider).toBe("local");
      expect(config.triage.strictness).toBe("standard");
      expect(config.triage.rules.always_check).toContain("rewards");
    });
  });

  describe("getConfig — .preflight/config.yml", () => {
    it("merges config.yml values with defaults", async () => {
      const configYaml = `
profile: full
related_projects:
  - path: /home/user/api
    alias: api
thresholds:
  session_stale_minutes: 60
`;
      vi.doMock("fs", () => {
        const fn = vi.fn((p: string) => {
          if (typeof p === "string" && p.includes(".preflight")) {
            if (p.endsWith("config.yml")) return true;
            if (p.endsWith("triage.yml")) return false;
            return true; // .preflight dir
          }
          return false;
        });
        return {
          existsSync: fn,
          readFileSync: vi.fn().mockReturnValue(configYaml),
        };
      });
      vi.doMock("../../src/lib/files.js", () => ({
        PROJECT_DIR: "/tmp/test-project",
      }));

      const { getConfig } = await import("../../src/lib/config.js");
      const config = getConfig();

      expect(config.profile).toBe("full");
      expect(config.related_projects).toHaveLength(1);
      expect(config.related_projects[0].alias).toBe("api");
      expect(config.thresholds.session_stale_minutes).toBe(60);
      // Defaults preserved for unset values
      expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
    });
  });

  describe("getConfig — .preflight/triage.yml", () => {
    it("merges triage.yml rules", async () => {
      const triageYaml = `
strictness: strict
rules:
  always_check:
    - payments
    - auth
  skip:
    - format
`;
      vi.doMock("fs", () => {
        const fn = vi.fn((p: string) => {
          if (typeof p === "string") {
            if (p.endsWith("config.yml")) return false;
            if (p.endsWith("triage.yml")) return true;
            if (p.includes(".preflight")) return true;
          }
          return false;
        });
        return {
          existsSync: fn,
          readFileSync: vi.fn().mockReturnValue(triageYaml),
        };
      });
      vi.doMock("../../src/lib/files.js", () => ({
        PROJECT_DIR: "/tmp/test-project",
      }));

      const { getConfig } = await import("../../src/lib/config.js");
      const config = getConfig();

      expect(config.triage.strictness).toBe("strict");
      expect(config.triage.rules.always_check).toEqual(["payments", "auth"]);
      expect(config.triage.rules.skip).toEqual(["format"]);
    });
  });

  describe("getConfig — malformed YAML", () => {
    it("falls back to defaults on invalid config.yml", async () => {
      vi.doMock("fs", () => {
        const fn = vi.fn((p: string) => {
          if (typeof p === "string") {
            if (p.endsWith("config.yml")) return true;
            if (p.endsWith("triage.yml")) return false;
            if (p.includes(".preflight")) return true;
          }
          return false;
        });
        return {
          existsSync: fn,
          readFileSync: vi.fn().mockImplementation(() => {
            throw new Error("invalid yaml");
          }),
        };
      });
      vi.doMock("../../src/lib/files.js", () => ({
        PROJECT_DIR: "/tmp/test-project",
      }));

      const { getConfig } = await import("../../src/lib/config.js");
      const config = getConfig();

      // Should still return defaults without throwing
      expect(config.profile).toBe("standard");
    });
  });

  describe("getConfig — env var fallback", () => {
    it("reads PROMPT_DISCIPLINE_PROFILE when no .preflight/ dir", async () => {
      const origEnv = process.env.PROMPT_DISCIPLINE_PROFILE;
      process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn(),
      }));
      vi.doMock("../../src/lib/files.js", () => ({
        PROJECT_DIR: "/tmp/test-project",
      }));

      const { getConfig } = await import("../../src/lib/config.js");
      const config = getConfig();

      expect(config.profile).toBe("minimal");

      // Cleanup
      if (origEnv === undefined) delete process.env.PROMPT_DISCIPLINE_PROFILE;
      else process.env.PROMPT_DISCIPLINE_PROFILE = origEnv;
    });

    it("ignores env vars when .preflight/ dir exists", async () => {
      const origEnv = process.env.PROMPT_DISCIPLINE_PROFILE;
      process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";

      vi.doMock("fs", () => {
        const fn = vi.fn((p: string) => {
          if (typeof p === "string" && p.includes(".preflight") && !p.endsWith(".yml")) return true;
          return false;
        });
        return {
          existsSync: fn,
          readFileSync: vi.fn(),
        };
      });
      vi.doMock("../../src/lib/files.js", () => ({
        PROJECT_DIR: "/tmp/test-project",
      }));

      const { getConfig } = await import("../../src/lib/config.js");
      const config = getConfig();

      // Should use default, NOT env var, because .preflight/ exists
      expect(config.profile).toBe("standard");

      if (origEnv === undefined) delete process.env.PROMPT_DISCIPLINE_PROFILE;
      else process.env.PROMPT_DISCIPLINE_PROFILE = origEnv;
    });
  });

  describe("hasPreflightConfig", () => {
    it("returns true when .preflight/ exists", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn((p: string) => typeof p === "string" && p.includes(".preflight")),
        readFileSync: vi.fn(),
      }));
      vi.doMock("../../src/lib/files.js", () => ({
        PROJECT_DIR: "/tmp/test-project",
      }));

      const { hasPreflightConfig } = await import("../../src/lib/config.js");
      expect(hasPreflightConfig()).toBe(true);
    });

    it("returns false when .preflight/ missing", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn(),
      }));
      vi.doMock("../../src/lib/files.js", () => ({
        PROJECT_DIR: "/tmp/test-project",
      }));

      const { hasPreflightConfig } = await import("../../src/lib/config.js");
      expect(hasPreflightConfig()).toBe(false);
    });
  });

  describe("getRelatedProjects", () => {
    it("returns paths from config", async () => {
      const configYaml = `
related_projects:
  - path: /home/user/api
    alias: api
  - path: /home/user/web
    alias: web
`;
      vi.doMock("fs", () => ({
        existsSync: vi.fn((p: string) => {
          if (typeof p === "string") {
            if (p.endsWith("config.yml")) return true;
            if (p.endsWith("triage.yml")) return false;
            if (p.includes(".preflight")) return true;
          }
          return false;
        }),
        readFileSync: vi.fn().mockReturnValue(configYaml),
      }));
      vi.doMock("../../src/lib/files.js", () => ({
        PROJECT_DIR: "/tmp/test-project",
      }));

      const { getRelatedProjects } = await import("../../src/lib/config.js");
      const projects = getRelatedProjects();

      expect(projects).toEqual(["/home/user/api", "/home/user/web"]);
    });
  });
});
