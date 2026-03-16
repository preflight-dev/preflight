import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const templatesDir = join(__dirname, "../../src/templates");

describe("CLAUDE.md rule templates", () => {
  it("strict template exists and contains required rules", async () => {
    const content = await readFile(join(templatesDir, "claude-rules-strict.md"), "utf-8");
    expect(content).toContain("preflight_check");
    expect(content).toContain("verify_completion");
    expect(content).toContain("clarify_intent");
    expect(content).toContain("checkpoint");
    expect(content).toContain("Strict Mode");
  });

  it("relaxed template exists and is shorter than strict", async () => {
    const strict = await readFile(join(templatesDir, "claude-rules-strict.md"), "utf-8");
    const relaxed = await readFile(join(templatesDir, "claude-rules-relaxed.md"), "utf-8");
    expect(relaxed.length).toBeLessThan(strict.length);
    expect(relaxed).toContain("preflight_check");
    expect(relaxed).toContain("Relaxed Mode");
  });

  it("strict template has ALWAYS keywords for critical rules", async () => {
    const content = await readFile(join(templatesDir, "claude-rules-strict.md"), "utf-8");
    const alwaysCount = (content.match(/ALWAYS/g) || []).length;
    expect(alwaysCount).toBeGreaterThanOrEqual(4);
  });

  it("relaxed template uses softer language", async () => {
    const content = await readFile(join(templatesDir, "claude-rules-relaxed.md"), "utf-8");
    expect(content).not.toContain("**ALWAYS**");
    expect(content).toContain("Recommended");
  });
});
