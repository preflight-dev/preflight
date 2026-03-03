import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";

// We need to re-import getConfig fresh each test since it caches
// Use dynamic import + module reset

const TEST_DIR = join(tmpdir(), `preflight-config-test-${process.pid}`);

describe("config", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Reset module cache by clearing the singleton
    vi.stubEnv("CLAUDE_PROJECT_DIR", TEST_DIR);
    // Clear all preflight env vars
    vi.stubEnv("PROMPT_DISCIPLINE_PROFILE", "");
    vi.stubEnv("PREFLIGHT_RELATED", "");
    vi.stubEnv("EMBEDDING_PROVIDER", "");
    vi.stubEnv("OPENAI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  // Since getConfig uses a singleton, we test loadConfig behavior via
  // reimporting the module. For simplicity, test the defaults and file parsing
  // by importing fresh each time.

  async function loadFreshConfig() {
    // Reset module registry to clear singleton
    vi.resetModules();
    const mod = await import("../../src/lib/config.js");
    return mod.getConfig();
  }

  it("returns default config when no .preflight/ dir exists", async () => {
    const config = await loadFreshConfig();
    expect(config.profile).toBe("standard");
    expect(config.related_projects).toEqual([]);
    expect(config.triage.strictness).toBe("standard");
    expect(config.thresholds.session_stale_minutes).toBe(30);
    expect(config.embeddings.provider).toBe("local");
  });

  it("respects PROMPT_DISCIPLINE_PROFILE env var when no .preflight/ dir", async () => {
    vi.stubEnv("PROMPT_DISCIPLINE_PROFILE", "minimal");
    const config = await loadFreshConfig();
    expect(config.profile).toBe("minimal");
  });

  it("respects PREFLIGHT_RELATED env var when no .preflight/ dir", async () => {
    vi.stubEnv("PREFLIGHT_RELATED", "/tmp/project-a, /tmp/project-b");
    const config = await loadFreshConfig();
    expect(config.related_projects).toHaveLength(2);
    expect(config.related_projects[0].path).toBe("/tmp/project-a");
    expect(config.related_projects[0].alias).toBe("project-a");
    expect(config.related_projects[1].path).toBe("/tmp/project-b");
  });

  it("respects EMBEDDING_PROVIDER env var when no .preflight/ dir", async () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    const config = await loadFreshConfig();
    expect(config.embeddings.provider).toBe("openai");
  });

  it("loads config from .preflight/config.yml", async () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(join(preflightDir, "config.yml"), `
profile: full
related_projects:
  - path: /srv/api
    alias: api
thresholds:
  session_stale_minutes: 60
embeddings:
  provider: openai
`);
    const config = await loadFreshConfig();
    expect(config.profile).toBe("full");
    expect(config.related_projects).toHaveLength(1);
    expect(config.related_projects[0].alias).toBe("api");
    expect(config.thresholds.session_stale_minutes).toBe(60);
    // Should preserve defaults for unspecified thresholds
    expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
    expect(config.embeddings.provider).toBe("openai");
  });

  it("loads triage rules from .preflight/triage.yml", async () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(join(preflightDir, "config.yml"), "profile: standard\n");
    writeFileSync(join(preflightDir, "triage.yml"), `
strictness: strict
rules:
  always_check:
    - deploy
    - billing
  skip:
    - typo
`);
    const config = await loadFreshConfig();
    expect(config.triage.strictness).toBe("strict");
    expect(config.triage.rules.always_check).toEqual(["deploy", "billing"]);
    expect(config.triage.rules.skip).toEqual(["typo"]);
  });

  it("ignores env vars when .preflight/ dir exists", async () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(join(preflightDir, "config.yml"), "profile: minimal\n");
    vi.stubEnv("PROMPT_DISCIPLINE_PROFILE", "full");
    const config = await loadFreshConfig();
    expect(config.profile).toBe("minimal");
  });

  it("handles malformed YAML gracefully", async () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(join(preflightDir, "config.yml"), "{{{{not yaml at all");
    // Should fall back to defaults without throwing
    const config = await loadFreshConfig();
    expect(config.profile).toBe("standard");
  });

  it("handles empty config.yml gracefully", async () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(join(preflightDir, "config.yml"), "");
    const config = await loadFreshConfig();
    expect(config.profile).toBe("standard");
  });
});

describe("hasPreflightConfig", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    vi.stubEnv("CLAUDE_PROJECT_DIR", TEST_DIR);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  it("returns false when .preflight/ does not exist", async () => {
    vi.resetModules();
    const { hasPreflightConfig } = await import("../../src/lib/config.js");
    expect(hasPreflightConfig()).toBe(false);
  });

  it("returns true when .preflight/ exists", async () => {
    mkdirSync(join(TEST_DIR, ".preflight"), { recursive: true });
    vi.resetModules();
    const { hasPreflightConfig } = await import("../../src/lib/config.js");
    expect(hasPreflightConfig()).toBe(true);
  });
});
