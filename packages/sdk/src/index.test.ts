import { describe, expect, it } from "vitest";
import { createSurfaceRegistry } from "@ovxa/surface-kit";
import { defaultComponents } from "./defaults";
import { Ovxa } from "./index";

describe("defaultComponents", () => {
  it("covers every reference component so a host can ship with one import", () => {
    const missing = createSurfaceRegistry()
      .names()
      .filter((name) => typeof defaultComponents[name] !== "function");
    expect(missing).toEqual([]);
  });

  it("still renders a component the host never registered", () => {
    expect(typeof defaultComponents["NotInTheKit"]).toBe("function");
  });
});

describe("Ovxa", () => {
  it("is the public embed", () => {
    expect(typeof Ovxa).toBe("function");
  });
});
