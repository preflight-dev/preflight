import { describe, it, expect } from "vitest";
import { searchContracts, type Contract } from "../../src/lib/contracts.js";

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    name: "UserProfile",
    kind: "interface",
    file: "src/types/user.ts",
    definition: "export interface UserProfile { id: string; name: string; }",
    project: "/test/project",
    extractedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("searchContracts", () => {
  it("returns all contracts for empty query", () => {
    const contracts = [makeContract(), makeContract({ name: "Order" })];
    const result = searchContracts("", contracts);
    expect(result).toHaveLength(2);
  });

  it("ranks exact name match highest", () => {
    const contracts = [
      makeContract({ name: "Order", definition: "order stuff" }),
      makeContract({ name: "UserProfile", definition: "includes order field" }),
    ];
    const result = searchContracts("Order", contracts);
    expect(result[0].name).toBe("Order");
  });

  it("matches file path terms", () => {
    const contracts = [
      makeContract({ name: "Foo", file: "src/auth/types.ts" }),
      makeContract({ name: "Bar", file: "src/billing/types.ts" }),
    ];
    const result = searchContracts("auth", contracts);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Foo");
  });

  it("returns empty array when no terms match", () => {
    const contracts = [makeContract()];
    const result = searchContracts("nonexistent", contracts);
    expect(result).toHaveLength(0);
  });

  it("scores additively across multiple terms", () => {
    const contracts = [
      makeContract({
        name: "UserProfile",
        file: "src/user/types.ts",
        definition: "export interface UserProfile { id: string; }",
      }),
      makeContract({
        name: "OrderProfile",
        file: "src/order/types.ts",
        definition: "export interface OrderProfile { id: string; }",
      }),
    ];
    // "user" matches name + file for UserProfile, only neither for OrderProfile
    const result = searchContracts("user profile", contracts);
    expect(result[0].name).toBe("UserProfile");
  });
});
