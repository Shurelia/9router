import { describe, it, expect, vi } from "vitest";
import { findPlugin } from "../../src/lib/mcp/stdioSseBridge.js";

describe("stdioSseBridge", () => {
  it("finds registered local plugins like browsermcp", () => {
    const plugin = findPlugin("browsermcp");
    expect(plugin).not.toBeNull();
    expect(plugin.name).toBe("browsermcp");
    expect(plugin.command).toBe("npx");
  });

  it("returns null for unknown plugins", () => {
    expect(findPlugin("nonexistent")).toBeNull();
  });
});
