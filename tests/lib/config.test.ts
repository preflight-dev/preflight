import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// We need to mock modules before importing config
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
    // Clear env vars
    delete process.env.PROMPT_DISCIPLINE_PROFILE;
    delete process.env.PREFLIGHT_RELATED;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    delete process.env.PROMPT_DISCIPLINE_PROFILE;
    delete process.env.PREFLIGHT_RELATED;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  async function loadFreshConfig() {
    const mod = await import("../../src/lib/config.js");
    return mod;
  }

  it("returns default config when no .preflight/ directory exists", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();

    expect(config.profile).toBe("standard");
    expect(config.related_projects).toEqual([]);
    expect(config.thresholds.session_stale_minutes).toBe(30);
    expect(config.embeddings.provider).toBe("local");
    expect(config.triage.strictness).toBe("standard");
  });

  it("applies env var overrides when no .preflight/ directory", async () => {
    mockedExistsSync.mockReturnValue(false);
    process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-123";

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();

    expect(config.profile).toBe("minimal");
    expect(config.embeddings.provider).toBe("openai");
    expect(config.embeddings.openai_api_key).toBe("sk-test-123");
  });

  it("parses PREFLIGHT_RELATED env var into related_projects", async () => {
    mockedExistsSync.mockReturnValue(false);
    process.env.PREFLIGHT_RELATED = "/path/to/foo, /path/to/bar";

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();

    expect(config.related_projects).toEqual([
      { path: "/path/to/foo", alias: "foo" },
      { path: "/path/to/bar", alias: "bar" },
    ]);
  });

  it("ignores invalid env profile values", async () => {
    mockedExistsSync.mockReturnValue(false);
    process.env.PROMPT_DISCIPLINE_PROFILE = "invalid_profile";

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();

    expect(config.profile).toBe("standard"); // stays default
  });

  it("loads config.yml and merges with defaults", async () => {
    const configYaml = `
profile: full
thresholds:
  session_stale_minutes: 60
`;
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === join("/fake/project", ".preflight")) return true;
      if (path === join("/fake/project", ".preflight", "config.yml")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(configYaml);

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();

    expect(config.profile).toBe("full");
    expect(config.thresholds.session_stale_minutes).toBe(60);
    // Other thresholds should keep defaults
    expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
  });

  it("loads triage.yml and merges with defaults", async () => {
    const triageYaml = `
strictness: strict
rules:
  always_check:
    - payments
    - auth
`;
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === join("/fake/project", ".preflight")) return true;
      if (path === join("/fake/project", ".preflight", "triage.yml")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(triageYaml);

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();

    expect(config.triage.strictness).toBe("strict");
    expect(config.triage.rules.always_check).toEqual(["payments", "auth"]);
  });

  it("ignores env vars when .preflight/ directory exists", async () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === join("/fake/project", ".preflight")) return true;
      return false;
    });
    process.env.PROMPT_DISCIPLINE_PROFILE = "full";

    const { getConfig } = await loadFreshConfig();
    const config = getConfig();

    // Should NOT apply env var since .preflight/ exists
    expect(config.profile).toBe("standard");
  });

  it("caches config on second call (singleton)", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { getConfig } = await loadFreshConfig();
    const config1 = getConfig();
    const config2 = getConfig();

    expect(config1).toBe(config2); // same reference
  });

  it("handles malformed config.yml gracefully", async () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === join("/fake/project", ".preflight")) return true;
      if (path === join("/fake/project", ".preflight", "config.yml")) return true;
      return false;
    });
    mockedReadFileSync.mockImplementation(() => { throw new Error("read error"); });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getConfig } = await loadFreshConfig();
    const config = getConfig();

    // Should fall back to defaults
    expect(config.profile).toBe("standard");
    warnSpy.mockRestore();
  });

  it("hasPreflightConfig returns true when .preflight/ exists", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return String(p) === join("/fake/project", ".preflight");
    });

    const { hasPreflightConfig } = await loadFreshConfig();
    expect(hasPreflightConfig()).toBe(true);
  });

  it("hasPreflightConfig returns false when .preflight/ missing", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { hasPreflightConfig } = await loadFreshConfig();
    expect(hasPreflightConfig()).toBe(false);
  });

  it("getRelatedProjects returns path array", async () => {
    const configYaml = `
related_projects:
  - path: /srv/api
    alias: api
  - path: /srv/web
    alias: web
`;
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === join("/fake/project", ".preflight")) return true;
      if (path === join("/fake/project", ".preflight", "config.yml")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(configYaml);

    const { getRelatedProjects } = await loadFreshConfig();
    expect(getRelatedProjects()).toEqual(["/srv/api", "/srv/web"]);
  });
});
