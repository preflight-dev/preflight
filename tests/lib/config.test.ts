import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs and path before importing config
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("js-yaml", () => ({
  load: vi.fn(),
}));

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/mock/project",
}));

import { existsSync, readFileSync } from "fs";
import { load as yamlLoad } from "js-yaml";

// Reset config singleton between tests
async function freshImport() {
  vi.resetModules();
  return await import("../../src/lib/config.js");
}

describe("config", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.PROMPT_DISCIPLINE_PROFILE;
    delete process.env.PREFLIGHT_RELATED;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  it("returns default config when no .preflight/ dir exists", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const { getConfig } = await freshImport();
    const config = getConfig();
    expect(config.profile).toBe("standard");
    expect(config.triage.strictness).toBe("standard");
    expect(config.embeddings.provider).toBe("local");
  });

  it("reads env vars when no .preflight/ dir exists", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";
    process.env.PREFLIGHT_RELATED = "/path/a, /path/b";
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";

    const { getConfig } = await freshImport();
    const config = getConfig();
    expect(config.profile).toBe("minimal");
    expect(config.related_projects).toHaveLength(2);
    expect(config.related_projects[0].path).toBe("/path/a");
    expect(config.related_projects[1].alias).toBe("b");
    expect(config.embeddings.provider).toBe("openai");
    expect(config.embeddings.openai_api_key).toBe("sk-test");
  });

  it("loads .preflight/config.yml when present", async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const s = String(p);
      return s.includes(".preflight") && !s.includes("triage");
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.mocked(yamlLoad).mockReturnValue({
      profile: "full",
      thresholds: { session_stale_minutes: 60 },
    });

    const { getConfig } = await freshImport();
    const config = getConfig();
    expect(config.profile).toBe("full");
    expect(config.thresholds.session_stale_minutes).toBe(60);
    // Other thresholds keep defaults
    expect(config.thresholds.max_tool_calls_before_checkpoint).toBe(100);
  });

  it("ignores env vars when .preflight/ dir exists", async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).includes(".preflight");
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.mocked(yamlLoad).mockReturnValue(null);
    process.env.PROMPT_DISCIPLINE_PROFILE = "full";

    const { getConfig } = await freshImport();
    const config = getConfig();
    // Should use default, not env var, because .preflight/ exists
    expect(config.profile).toBe("standard");
  });

  it("hasPreflightConfig returns true when dir exists", async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith(".preflight");
    });
    const { hasPreflightConfig } = await freshImport();
    expect(hasPreflightConfig()).toBe(true);
  });

  it("handles malformed yaml gracefully", async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).includes(".preflight") && !String(p).includes("triage");
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.mocked(yamlLoad).mockImplementation(() => {
      throw new Error("bad yaml");
    });

    const { getConfig } = await freshImport();
    // Should fall back to defaults without throwing
    const config = getConfig();
    expect(config.profile).toBe("standard");
  });
});
