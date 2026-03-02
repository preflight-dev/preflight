import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const FIXED_TEST_DIR = join(tmpdir(), "preflight-config-test");

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: join(require("os").tmpdir(), "preflight-config-test"),
}));

// Import after mock so config uses our test dir
import { getConfig, resetConfig, hasPreflightConfig, getRelatedProjects } from "../../src/lib/config.js";

const TEST_DIR = FIXED_TEST_DIR;

describe("config", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    resetConfig();
    // Clear relevant env vars
    delete process.env.PROMPT_DISCIPLINE_PROFILE;
    delete process.env.PREFLIGHT_RELATED;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns default config when no .preflight/ dir exists", () => {
    const config = getConfig();
    expect(config.profile).toBe("standard");
    expect(config.related_projects).toEqual([]);
    expect(config.thresholds.session_stale_minutes).toBe(30);
    expect(config.embeddings.provider).toBe("local");
    expect(config.triage.strictness).toBe("standard");
  });

  it("caches config on repeated calls", () => {
    const a = getConfig();
    const b = getConfig();
    expect(a).toBe(b); // same reference
  });

  it("resetConfig forces reload", () => {
    const a = getConfig();
    resetConfig();
    const b = getConfig();
    expect(a).not.toBe(b); // different reference
    expect(a).toEqual(b); // same values (no config files changed)
  });

  it("reads .preflight/config.yml", () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(
      join(preflightDir, "config.yml"),
      `profile: full\nthresholds:\n  session_stale_minutes: 60\n`
    );

    const config = getConfig();
    expect(config.profile).toBe("full");
    expect(config.thresholds.session_stale_minutes).toBe(60);
    // Other thresholds should keep defaults
    expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
  });

  it("reads .preflight/triage.yml", () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    // Need config.yml too (or just the dir)
    writeFileSync(
      join(preflightDir, "triage.yml"),
      `strictness: strict\nrules:\n  always_check:\n    - billing\n    - auth\n`
    );

    const config = getConfig();
    expect(config.triage.strictness).toBe("strict");
    expect(config.triage.rules.always_check).toEqual(["billing", "auth"]);
    // skip and cross_service_keywords should keep defaults
    expect(config.triage.rules.skip).toEqual(["commit", "format", "lint"]);
  });

  it("reads related_projects from config.yml", () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(
      join(preflightDir, "config.yml"),
      `related_projects:\n  - path: /tmp/foo\n    alias: foo-svc\n`
    );

    const config = getConfig();
    expect(config.related_projects).toEqual([{ path: "/tmp/foo", alias: "foo-svc" }]);
    expect(getRelatedProjects()).toEqual(["/tmp/foo"]);
  });

  it("falls back to env vars when no .preflight/ dir", () => {
    process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";
    process.env.PREFLIGHT_RELATED = "/tmp/a,/tmp/b";
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";

    const config = getConfig();
    expect(config.profile).toBe("minimal");
    expect(config.related_projects).toHaveLength(2);
    expect(config.related_projects[0].path).toBe("/tmp/a");
    expect(config.related_projects[1].alias).toBe("b");
    expect(config.embeddings.provider).toBe("openai");
    expect(config.embeddings.openai_api_key).toBe("sk-test");
  });

  it("ignores env vars when .preflight/ dir exists", () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(join(preflightDir, "config.yml"), `profile: full\n`);

    process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";

    const config = getConfig();
    // .preflight/ exists, so env var should NOT override
    expect(config.profile).toBe("full");
  });

  it("handles malformed yaml gracefully", () => {
    const preflightDir = join(TEST_DIR, ".preflight");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(join(preflightDir, "config.yml"), `{{{not yaml`);

    // Should not throw, should fall back to defaults
    const config = getConfig();
    expect(config.profile).toBe("standard");
  });

  it("hasPreflightConfig returns correct value", () => {
    expect(hasPreflightConfig()).toBe(false);

    mkdirSync(join(TEST_DIR, ".preflight"), { recursive: true });
    expect(hasPreflightConfig()).toBe(true);
  });
});
