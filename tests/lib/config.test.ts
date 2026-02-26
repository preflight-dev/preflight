import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We need to reset the singleton between tests, so we dynamically import
// after setting PROJECT_DIR via env var.

function makeTemp(): string {
  return mkdtempSync(join(tmpdir(), "preflight-config-test-"));
}

describe("config", () => {
  let tmpDir: string;
  let originalProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = makeTemp();
    originalProjectDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    // Clear all preflight-related env vars
    delete process.env.PROMPT_DISCIPLINE_PROFILE;
    delete process.env.PREFLIGHT_RELATED;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalProjectDir !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = originalProjectDir;
    } else {
      delete process.env.CLAUDE_PROJECT_DIR;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function loadConfig() {
    // Reset modules to clear the singleton cache
    const mod = await import("../../src/lib/config.js");
    // Force reload by accessing internal state — the module caches _config
    // We re-import to get a fresh module instance thanks to vi.resetModules()
    return mod;
  }

  it("returns default config when no .preflight/ dir and no env vars", async () => {
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.profile).toBe("standard");
    expect(config.related_projects).toEqual([]);
    expect(config.triage.strictness).toBe("standard");
    expect(config.embeddings.provider).toBe("local");
    expect(config.thresholds.session_stale_minutes).toBe(30);
  });

  it("reads profile from env var when no .preflight/ dir", async () => {
    process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.profile).toBe("minimal");
  });

  it("reads related projects from env var when no .preflight/ dir", async () => {
    process.env.PREFLIGHT_RELATED = "/tmp/svc-a, /tmp/svc-b";
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.related_projects).toHaveLength(2);
    expect(config.related_projects[0].path).toBe("/tmp/svc-a");
    expect(config.related_projects[0].alias).toBe("svc-a");
    expect(config.related_projects[1].alias).toBe("svc-b");
  });

  it("reads embedding provider from env var", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.embeddings.provider).toBe("openai");
    expect(config.embeddings.openai_api_key).toBe("sk-test");
  });

  it("loads .preflight/config.yml and overrides defaults", async () => {
    const preflightDir = join(tmpDir, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(
      join(preflightDir, "config.yml"),
      `profile: full
related_projects:
  - path: /opt/api
    alias: api
thresholds:
  session_stale_minutes: 60
embeddings:
  provider: openai
`,
    );

    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.profile).toBe("full");
    expect(config.related_projects).toHaveLength(1);
    expect(config.related_projects[0].alias).toBe("api");
    expect(config.thresholds.session_stale_minutes).toBe(60);
    // Non-overridden thresholds should keep defaults
    expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
    expect(config.embeddings.provider).toBe("openai");
  });

  it("loads .preflight/triage.yml and merges rules", async () => {
    const preflightDir = join(tmpDir, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    // Need config.yml too (even empty) to establish .preflight/ dir
    writeFileSync(join(preflightDir, "config.yml"), "profile: standard\n");
    writeFileSync(
      join(preflightDir, "triage.yml"),
      `strictness: strict
rules:
  always_check:
    - deploy
    - billing
  skip:
    - hello
`,
    );

    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.triage.strictness).toBe("strict");
    expect(config.triage.rules.always_check).toEqual(["deploy", "billing"]);
    expect(config.triage.rules.skip).toEqual(["hello"]);
    // cross_service_keywords should still be default since triage.yml didn't override it
    expect(config.triage.rules.cross_service_keywords).toEqual([
      "auth", "notification", "event", "webhook",
    ]);
  });

  it("ignores env vars when .preflight/ directory exists", async () => {
    const preflightDir = join(tmpDir, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(join(preflightDir, "config.yml"), "profile: minimal\n");

    // Set env vars that should be ignored
    process.env.PROMPT_DISCIPLINE_PROFILE = "full";
    process.env.PREFLIGHT_RELATED = "/tmp/ignored";

    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.profile).toBe("minimal");
    expect(config.related_projects).toEqual([]);
  });

  it("handles malformed config.yml gracefully", async () => {
    const preflightDir = join(tmpDir, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(join(preflightDir, "config.yml"), "{{{{ not yaml");

    // Should not throw — falls back to defaults
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.profile).toBe("standard");
  });

  it("hasPreflightConfig returns true when .preflight/ exists", async () => {
    mkdirSync(join(tmpDir, ".preflight"), { recursive: true });
    const { hasPreflightConfig } = await loadConfig();
    expect(hasPreflightConfig()).toBe(true);
  });

  it("hasPreflightConfig returns false when .preflight/ is missing", async () => {
    const { hasPreflightConfig } = await loadConfig();
    expect(hasPreflightConfig()).toBe(false);
  });

  it("getRelatedProjects returns flat path array", async () => {
    const preflightDir = join(tmpDir, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(
      join(preflightDir, "config.yml"),
      `related_projects:
  - path: /a
    alias: a
  - path: /b
    alias: b
`,
    );

    const { getRelatedProjects } = await loadConfig();
    expect(getRelatedProjects()).toEqual(["/a", "/b"]);
  });

  it("ignores invalid profile values from env vars", async () => {
    process.env.PROMPT_DISCIPLINE_PROFILE = "turbo";
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.profile).toBe("standard"); // default, not "turbo"
  });
});
