import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to mock fs and files before importing config
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

import { existsSync, readFileSync } from "fs";
import { getConfig, resetConfig, hasPreflightConfig, getRelatedProjects } from "../../src/lib/config.js";

const mockExists = existsSync as ReturnType<typeof vi.fn>;
const mockRead = readFileSync as ReturnType<typeof vi.fn>;

describe("config", () => {
  beforeEach(() => {
    resetConfig();
    mockExists.mockReset();
    mockRead.mockReset();
    // Default: no .preflight dir
    mockExists.mockReturnValue(false);
  });

  afterEach(() => {
    // Clean env vars
    delete process.env.PROMPT_DISCIPLINE_PROFILE;
    delete process.env.PREFLIGHT_RELATED;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  it("returns defaults when no config exists", () => {
    const cfg = getConfig();
    expect(cfg.profile).toBe("standard");
    expect(cfg.embeddings.provider).toBe("local");
    expect(cfg.triage.strictness).toBe("standard");
    expect(cfg.related_projects).toEqual([]);
  });

  it("reads env vars when no .preflight dir", () => {
    process.env.PROMPT_DISCIPLINE_PROFILE = "minimal";
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    const cfg = getConfig();
    expect(cfg.profile).toBe("minimal");
    expect(cfg.embeddings.provider).toBe("openai");
    expect(cfg.embeddings.openai_api_key).toBe("sk-test");
  });

  it("ignores invalid env profile values", () => {
    process.env.PROMPT_DISCIPLINE_PROFILE = "turbo";
    const cfg = getConfig();
    expect(cfg.profile).toBe("standard");
  });

  it("parses PREFLIGHT_RELATED env var", () => {
    process.env.PREFLIGHT_RELATED = "/a/b, /c/d";
    const cfg = getConfig();
    expect(cfg.related_projects).toEqual([
      { path: "/a/b", alias: "b" },
      { path: "/c/d", alias: "d" },
    ]);
    expect(getRelatedProjects()).toEqual(["/a/b", "/c/d"]);
  });

  it("loads config.yml and validates profile", () => {
    mockExists.mockImplementation((p: any) => {
      const s = String(p);
      return s.endsWith(".preflight") || s.endsWith("config.yml");
    });
    mockRead.mockReturnValue('profile: "full"\n');

    const cfg = getConfig();
    expect(cfg.profile).toBe("full");
  });

  it("warns and ignores invalid profile from YAML", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExists.mockImplementation((p: any) => {
      const s = String(p);
      return s.endsWith(".preflight") || s.endsWith("config.yml");
    });
    mockRead.mockReturnValue('profile: "turbo"\n');

    const cfg = getConfig();
    expect(cfg.profile).toBe("standard"); // fallback
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("invalid profile"));
    warnSpy.mockRestore();
  });

  it("warns and ignores invalid embedding provider from YAML", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExists.mockImplementation((p: any) => {
      const s = String(p);
      return s.endsWith(".preflight") || s.endsWith("config.yml");
    });
    mockRead.mockReturnValue('embeddings:\n  provider: "ollama"\n');

    const cfg = getConfig();
    expect(cfg.embeddings.provider).toBe("local"); // fallback
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("invalid embedding provider"));
    warnSpy.mockRestore();
  });

  it("warns and ignores invalid triage strictness from YAML", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExists.mockImplementation((p: any) => {
      const s = String(p);
      return s.endsWith(".preflight") || s.endsWith("triage.yml");
    });
    mockRead.mockReturnValue('strictness: "extreme"\n');

    const cfg = getConfig();
    expect(cfg.triage.strictness).toBe("standard"); // fallback
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("invalid triage strictness"));
    warnSpy.mockRestore();
  });

  it("caches config on second call", () => {
    const cfg1 = getConfig();
    const cfg2 = getConfig();
    expect(cfg1).toBe(cfg2); // same reference
  });

  it("resetConfig clears cache", () => {
    const cfg1 = getConfig();
    resetConfig();
    const cfg2 = getConfig();
    expect(cfg1).not.toBe(cfg2);
    expect(cfg1).toEqual(cfg2);
  });

  it("hasPreflightConfig returns false when dir missing", () => {
    expect(hasPreflightConfig()).toBe(false);
  });

  it("hasPreflightConfig returns true when dir exists", () => {
    mockExists.mockImplementation((p: any) => String(p).endsWith(".preflight"));
    expect(hasPreflightConfig()).toBe(true);
  });

  it("handles malformed YAML gracefully", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExists.mockImplementation((p: any) => {
      const s = String(p);
      return s.endsWith(".preflight") || s.endsWith("config.yml");
    });
    mockRead.mockImplementation(() => { throw new Error("read error"); });

    const cfg = getConfig();
    expect(cfg.profile).toBe("standard"); // defaults
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
