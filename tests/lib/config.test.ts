import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";

// We need to control PROJECT_DIR and reset the config singleton between tests.
// The config module reads from PROJECT_DIR at load time, so we mock files.ts.

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "preflight-config-test-"));
  vi.stubEnv("CLAUDE_PROJECT_DIR", tempDir);
  // Reset the cached config singleton by re-importing
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tempDir, { recursive: true, force: true });
});

async function loadConfig() {
  const mod = await import("../../src/lib/config.js");
  return mod;
}

describe("config", () => {
  it("returns default config when no .preflight/ exists and no env vars", async () => {
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.profile).toBe("standard");
    expect(config.related_projects).toEqual([]);
    expect(config.thresholds.session_stale_minutes).toBe(30);
    expect(config.embeddings.provider).toBe("local");
    expect(config.triage.strictness).toBe("standard");
    expect(config.triage.rules.always_check).toContain("migration");
  });

  it("reads profile from env when no .preflight/ dir", async () => {
    vi.stubEnv("PROMPT_DISCIPLINE_PROFILE", "minimal");
    const { getConfig } = await loadConfig();
    expect(getConfig().profile).toBe("minimal");
  });

  it("reads related projects from env when no .preflight/ dir", async () => {
    vi.stubEnv("PREFLIGHT_RELATED", "/tmp/foo, /tmp/bar");
    const { getConfig } = await loadConfig();
    const projects = getConfig().related_projects;
    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({ path: "/tmp/foo", alias: "foo" });
    expect(projects[1]).toEqual({ path: "/tmp/bar", alias: "bar" });
  });

  it("reads embedding provider from env", async () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    const { getConfig } = await loadConfig();
    expect(getConfig().embeddings.provider).toBe("openai");
  });

  it("ignores invalid profile env values", async () => {
    vi.stubEnv("PROMPT_DISCIPLINE_PROFILE", "turbo");
    const { getConfig } = await loadConfig();
    expect(getConfig().profile).toBe("standard"); // default
  });

  it("loads config from .preflight/config.yml", async () => {
    const preflightDir = join(tempDir, ".preflight");
    mkdirSync(preflightDir);
    writeFileSync(
      join(preflightDir, "config.yml"),
      `profile: full
thresholds:
  session_stale_minutes: 60
related_projects:
  - path: /opt/api
    alias: api-service
embeddings:
  provider: openai
`
    );
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.profile).toBe("full");
    expect(config.thresholds.session_stale_minutes).toBe(60);
    // Other thresholds should keep defaults
    expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
    expect(config.related_projects).toEqual([{ path: "/opt/api", alias: "api-service" }]);
    expect(config.embeddings.provider).toBe("openai");
  });

  it("loads triage rules from .preflight/triage.yml", async () => {
    const preflightDir = join(tempDir, ".preflight");
    mkdirSync(preflightDir);
    writeFileSync(
      join(preflightDir, "triage.yml"),
      `strictness: strict
rules:
  always_check:
    - payments
    - auth
  skip:
    - format
`
    );
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.triage.strictness).toBe("strict");
    expect(config.triage.rules.always_check).toEqual(["payments", "auth"]);
    expect(config.triage.rules.skip).toEqual(["format"]);
  });

  it("ignores env vars when .preflight/ directory exists", async () => {
    const preflightDir = join(tempDir, ".preflight");
    mkdirSync(preflightDir);
    writeFileSync(join(preflightDir, "config.yml"), "profile: minimal\n");
    vi.stubEnv("PROMPT_DISCIPLINE_PROFILE", "full");
    const { getConfig } = await loadConfig();
    // .preflight/ takes precedence, env var ignored
    expect(getConfig().profile).toBe("minimal");
  });

  it("handles malformed YAML gracefully", async () => {
    const preflightDir = join(tempDir, ".preflight");
    mkdirSync(preflightDir);
    writeFileSync(join(preflightDir, "config.yml"), "{{invalid yaml");
    const { getConfig } = await loadConfig();
    // Should fall back to defaults without crashing
    expect(getConfig().profile).toBe("standard");
  });

  it("hasPreflightConfig returns true when .preflight/ exists", async () => {
    mkdirSync(join(tempDir, ".preflight"));
    const { hasPreflightConfig } = await loadConfig();
    expect(hasPreflightConfig()).toBe(true);
  });

  it("hasPreflightConfig returns false when .preflight/ does not exist", async () => {
    const { hasPreflightConfig } = await loadConfig();
    expect(hasPreflightConfig()).toBe(false);
  });

  it("getRelatedProjects returns path array for backward compat", async () => {
    const preflightDir = join(tempDir, ".preflight");
    mkdirSync(preflightDir);
    writeFileSync(
      join(preflightDir, "config.yml"),
      `related_projects:
  - path: /a
    alias: a
  - path: /b
    alias: b
`
    );
    const { getRelatedProjects } = await loadConfig();
    expect(getRelatedProjects()).toEqual(["/a", "/b"]);
  });
});
