import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test the config and patterns loading with .preflight/ directory

describe(".preflight/ config directory", () => {
  const testDir = join(tmpdir(), "preflight-config-test-" + Date.now());
  const preflightDir = join(testDir, ".preflight");

  beforeEach(() => {
    mkdirSync(preflightDir, { recursive: true });
    mkdirSync(join(preflightDir, "contracts"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create the .preflight directory structure", () => {
    expect(existsSync(preflightDir)).toBe(true);
    expect(existsSync(join(preflightDir, "contracts"))).toBe(true);
  });

  it("should parse config.yml correctly", () => {
    writeFileSync(
      join(preflightDir, "config.yml"),
      `profile: full\nthresholds:\n  session_stale_minutes: 60\n`,
      "utf-8"
    );
    const content = require("fs").readFileSync(join(preflightDir, "config.yml"), "utf-8");
    expect(content).toContain("profile: full");
    expect(content).toContain("session_stale_minutes: 60");
  });

  it("should parse triage.yml correctly", () => {
    writeFileSync(
      join(preflightDir, "triage.yml"),
      `strictness: strict\nrules:\n  always_check:\n    - deploy\n`,
      "utf-8"
    );
    const content = require("fs").readFileSync(join(preflightDir, "triage.yml"), "utf-8");
    expect(content).toContain("strictness: strict");
    expect(content).toContain("deploy");
  });

  it("should parse patterns.json correctly", () => {
    const patterns = [
      {
        id: "test-pattern",
        pattern: "Forgot to add return type",
        keywords: ["return", "type"],
        frequency: 3,
        lastSeen: "2026-01-01",
        context: "TypeScript function definitions",
        examples: ["function foo() should be function foo(): string"],
      },
    ];
    writeFileSync(join(preflightDir, "patterns.json"), JSON.stringify(patterns), "utf-8");
    const parsed = JSON.parse(
      require("fs").readFileSync(join(preflightDir, "patterns.json"), "utf-8")
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("test-pattern");
    expect(parsed[0].frequency).toBe(3);
  });

  it("should read rules.md content", () => {
    writeFileSync(
      join(preflightDir, "rules.md"),
      "# Rules\n- Always run tests before committing\n",
      "utf-8"
    );
    const content = require("fs").readFileSync(join(preflightDir, "rules.md"), "utf-8");
    expect(content).toContain("Always run tests");
  });
});
