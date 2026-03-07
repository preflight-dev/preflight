import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Mock fs and files modules
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/fake/project",
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Clean env
    delete process.env.PROMPT_DISCIPLINE_PROFILE;
    delete process.env.PREFLIGHT_RELATED;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadFreshConfig() {
    const mod = await import("../../src/lib/config.js");
    return mod;
  }

  it("returns default config when no .preflight dir and no env vars", async () => {
    mockedExistsSync.mockReturnValue(false);
    const { getConfig } = await loadFreshConfig();
    const config = getConfig();

    expect(config.profile).toBe("standard");
    expect(config.related_projects).toEqual([]);
    expect(config.thresholds.session_stale_minutes).toBe(30);
    expect(config.embeddings.provider).toBe("local");
    expect(config.triage.strictness).toBe("standard");
  });

  it("reads env var PROMPT_DISCIPLINE_PROFILE when no .preflight dir", async () => {
    mockedExistsSync.mockReturnValue(false);
    process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();
    expect(config.profile).toBe("minimal");
  });

  it("reads env var PREFLIGHT_RELATED when no .preflight dir", async () => {
    mockedExistsSync.mockReturnValue(false);
    process.env.PREFLIGHT_RELATED = "/proj/a, /proj/b";

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();
    expect(config.related_projects).toEqual([
      { path: "/proj/a", alias: "a" },
      { path: "/proj/b", alias: "b" },
    ]);
  });

  it("reads env var EMBEDDING_PROVIDER when no .preflight dir", async () => {
    mockedExistsSync.mockReturnValue(false);
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();
    expect(config.embeddings.provider).toBe("openai");
    expect(config.embeddings.openai_api_key).toBe("sk-test");
  });

  it("ignores invalid PROMPT_DISCIPLINE_PROFILE values", async () => {
    mockedExistsSync.mockReturnValue(false);
    process.env.PROMPT_DISCIPLINE_PROFILE = "turbo";

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();
    expect(config.profile).toBe("standard"); // default
  });

  it("loads config from .preflight/config.yml", async () => {
    mockedExistsSync.mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith(".preflight")) return true;
      if (path.endsWith("config.yml")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      "profile: full\nthresholds:\n  session_stale_minutes: 60\n"
    );

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();
    expect(config.profile).toBe("full");
    expect(config.thresholds.session_stale_minutes).toBe(60);
    // Other defaults preserved
    expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
  });

  it("loads triage config from .preflight/triage.yml", async () => {
    mockedExistsSync.mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith(".preflight")) return true;
      if (path.endsWith("triage.yml")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue("strictness: strict\n");

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();
    expect(config.triage.strictness).toBe("strict");
  });

  it("ignores env vars when .preflight dir exists", async () => {
    mockedExistsSync.mockImplementation((p: any) => {
      return String(p).endsWith(".preflight");
    });
    process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();
    expect(config.profile).toBe("standard"); // env var ignored
  });

  it("caches config (singleton)", async () => {
    mockedExistsSync.mockReturnValue(false);
    const { getConfig } = await loadFreshConfig();
    const c1 = getConfig();
    const c2 = getConfig();
    expect(c1).toBe(c2); // same reference
  });

  it("handles malformed config.yml gracefully", async () => {
    mockedExistsSync.mockImplementation((p: any) => {
      const path = String(p);
      return path.endsWith(".preflight") || path.endsWith("config.yml");
    });
    mockedReadFileSync.mockReturnValue(": invalid: yaml: {{{}}}");

    const { getConfig } = await loadFreshConfig();
    // Should not throw, should fall back to defaults
    const config = getConfig();
    expect(config.profile).toBe("standard");
  });

  it("getRelatedProjects returns paths only", async () => {
    mockedExistsSync.mockReturnValue(false);
    process.env.PREFLIGHT_RELATED = "/proj/alpha";

    const { getRelatedProjects } = await loadFreshConfig();
    expect(getRelatedProjects()).toEqual(["/proj/alpha"]);
  });

  it("hasPreflightConfig returns true when dir exists", async () => {
    mockedExistsSync.mockImplementation((p: any) =>
      String(p).endsWith(".preflight")
    );

    const { hasPreflightConfig } = await loadFreshConfig();
    expect(hasPreflightConfig()).toBe(true);
  });

  it("hasPreflightConfig returns false when dir missing", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { hasPreflightConfig } = await loadFreshConfig();
    expect(hasPreflightConfig()).toBe(false);
  });
});
