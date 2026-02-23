import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the config module before importing profiles
vi.mock("../src/lib/config.js", () => ({
  getConfig: vi.fn(),
}));

import { isToolEnabled, getProfile } from "../src/profiles.js";
import { getConfig } from "../src/lib/config.js";

const mockedGetConfig = vi.mocked(getConfig);

describe("isToolEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("minimal profile enables only 5 core tools", () => {
    mockedGetConfig.mockReturnValue({ profile: "minimal" } as ReturnType<typeof getConfig>);

    expect(isToolEnabled("preflight_check")).toBe(true);
    expect(isToolEnabled("clarify_intent")).toBe(true);
    expect(isToolEnabled("check_session_health")).toBe(true);
    expect(isToolEnabled("session_stats")).toBe(true);
    expect(isToolEnabled("prompt_score")).toBe(true);

    // These should be disabled in minimal
    expect(isToolEnabled("scope_work")).toBe(false);
    expect(isToolEnabled("search_history")).toBe(false);
    expect(isToolEnabled("onboard_project")).toBe(false);
  });

  it("standard profile enables all 24 tools", () => {
    mockedGetConfig.mockReturnValue({ profile: "standard" } as ReturnType<typeof getConfig>);

    expect(isToolEnabled("preflight_check")).toBe(true);
    expect(isToolEnabled("scope_work")).toBe(true);
    expect(isToolEnabled("search_history")).toBe(true);
    expect(isToolEnabled("onboard_project")).toBe(true);
    expect(isToolEnabled("estimate_cost")).toBe(true);
    expect(isToolEnabled("search_contracts")).toBe(true);
  });

  it("full profile enables same tools as standard", () => {
    mockedGetConfig.mockReturnValue({ profile: "full" } as ReturnType<typeof getConfig>);

    expect(isToolEnabled("preflight_check")).toBe(true);
    expect(isToolEnabled("scope_work")).toBe(true);
    expect(isToolEnabled("search_history")).toBe(true);
    expect(isToolEnabled("estimate_cost")).toBe(true);
  });

  it("unknown tool name returns false for all profiles", () => {
    mockedGetConfig.mockReturnValue({ profile: "standard" } as ReturnType<typeof getConfig>);
    expect(isToolEnabled("nonexistent_tool")).toBe(false);
  });
});

describe("getProfile", () => {
  it("returns the profile from config", () => {
    mockedGetConfig.mockReturnValue({ profile: "minimal" } as ReturnType<typeof getConfig>);
    expect(getProfile()).toBe("minimal");
  });
});
