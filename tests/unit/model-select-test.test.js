import { describe, it, expect } from "vitest";
import { getModelButtonClass } from "@/shared/utils/modelSelectUtils.js";

describe("ModelSelectModal test model outline states", () => {
  it("applies green outline and tint when model test passes", () => {
    const unselected = getModelButtonClass({ isSelected: false, isAdded: false, testStatus: "ok" });
    expect(unselected).toContain("border-green-500");
    expect(unselected).toContain("bg-green-500/5");

    const added = getModelButtonClass({ isSelected: false, isAdded: true, testStatus: "ok" });
    expect(added).toContain("border-green-500");
    expect(added).toContain("ring-green-400");
  });

  it("applies red outline and tint when model test fails", () => {
    const unselected = getModelButtonClass({ isSelected: false, isAdded: false, testStatus: "error" });
    expect(unselected).toContain("border-red-500");
    expect(unselected).toContain("bg-red-500/5");

    const added = getModelButtonClass({ isSelected: false, isAdded: true, testStatus: "error" });
    expect(added).toContain("border-red-500");
    expect(added).toContain("ring-red-400");
  });

  it("applies pulse animation when model is testing", () => {
    const testing = getModelButtonClass({ isSelected: false, isAdded: false, testStatus: "testing" });
    expect(testing).toContain("animate-pulse");
    expect(testing).toContain("border-primary");
  });

  it("retains normal styling when testStatus is not set", () => {
    const normal = getModelButtonClass({ isSelected: false, isAdded: false });
    expect(normal).toContain("border-border");
    expect(normal).not.toContain("border-green-500");
    expect(normal).not.toContain("border-red-500");

    const placeholder = getModelButtonClass({ isPlaceholder: true });
    expect(placeholder).toContain("border-dashed");
  });
});
