import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceEvent } from "@ovxa/protocol";
import { SCHEMA_VERSION, parseSurface, type Surface } from "@ovxa/schema";
import { createSurfaceRegistry } from "@ovxa/surface-kit";
import type { SurfaceSource } from "@ovxa/react";
import { themeStyle } from "@ovxa/react";
import { defaultComponents } from "./defaults";
import { Ovxa, OvxaSearch, defaultUseCases, filterUseCases } from "./index";

const now = "2026-09-17T12:00:00.000Z";

function shell(intent: string): Surface {
  return parseSurface({
    schemaVersion: SCHEMA_VERSION,
    id: "srf_test",
    intent,
    kind: "dashboard",
    title: `Surface for: ${intent}`,
    layout: { columns: 2, density: "comfortable", maxWidth: "wide" },
    state: {},
    root: [],
    actions: [],
    status: "streaming",
    createdAt: now,
    updatedAt: now,
  });
}

/** A client that answers every intent with one StatCard, and records the calls. */
function fakeClient(): SurfaceSource & { intents: string[] } {
  const intents: string[] = [];
  return {
    intents,
    async *stream(request): AsyncGenerator<SurfaceEvent, unknown> {
      intents.push(request.intent);
      yield { type: "surface.start", surface: shell(request.intent), seq: 0 };
      yield {
        type: "component.add",
        surfaceId: "srf_test",
        parentId: null,
        node: { id: "stat", type: "StatCard", props: { label: "Revenue", value: "$91.2k" } },
        seq: 1,
      };
      yield { type: "surface.complete", surfaceId: "srf_test", seq: 2 };
      return null;
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

async function render(element: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function input(host: HTMLElement): HTMLInputElement {
  const element = host.querySelector<HTMLInputElement>("input[role=combobox]");
  if (!element) throw new Error("search input not rendered");
  return element;
}

/** Types into a controlled input. Bypasses React's value tracker via the prototype setter. */
async function type(field: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(field: HTMLInputElement, name: string): Promise<void> {
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}

async function submit(field: HTMLInputElement): Promise<void> {
  await act(async () => {
    field.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

describe("defaultComponents", () => {
  it("covers every reference component so a host can ship with one import", () => {
    const missing = createSurfaceRegistry()
      .names()
      .filter((name) => typeof defaultComponents[name] !== "function");
    expect(missing).toEqual([]);
  });

  it("does not pretend unknown types are registered — the renderer falls back", () => {
    expect(defaultComponents["NotInTheKit"]).toBeUndefined();
  });
});

describe("use cases", () => {
  it("cover the jobs the product is for", () => {
    expect(defaultUseCases.map((useCase) => useCase.id)).toEqual([
      "compare",
      "choose",
      "configure",
      "approve",
      "investigate",
      "monitor",
    ]);
    for (const useCase of defaultUseCases) {
      expect(useCase.intent.length).toBeGreaterThan(10);
      expect(useCase.description.length).toBeGreaterThan(10);
    }
  });

  it("filter across title, intent and description, case-insensitively", () => {
    expect(filterUseCases(defaultUseCases, "")).toHaveLength(defaultUseCases.length);
    expect(filterUseCases(defaultUseCases, "REFUND").map((useCase) => useCase.id)).toEqual([
      "approve",
    ]);
    expect(filterUseCases(defaultUseCases, "nothing matches this")).toEqual([]);
  });
});

describe("theme", () => {
  it("maps tokens to --ovxa-* custom properties and drops empties", () => {
    expect(themeStyle(undefined)).toBeUndefined();
    expect(themeStyle({})).toBeUndefined();
    expect(themeStyle({ radius: "4px", accent: "", muted: "gray" })).toEqual({
      "--ovxa-radius": "4px",
      "--ovxa-muted": "gray",
    });
  });
});

describe("Ovxa", () => {
  it("renders a streamed surface inside one .ovxa root carrying the theme", async () => {
    const client = fakeClient();
    const host = await render(
      <Ovxa intent="Compare Q2 against Q1" client={client} theme={{ radius: "2px" }} />,
    );
    await flush();

    const rootNode = host.querySelector<HTMLElement>(".ovxa");
    expect(rootNode?.getAttribute("data-ovxa-status")).toBe("ready");
    expect(rootNode?.style.getPropertyValue("--ovxa-radius")).toBe("2px");
    expect(host.querySelector(".ovxa-stat-value")?.textContent).toBe("$91.2k");
    expect(client.intents).toEqual(["Compare Q2 against Q1"]);
  });

  it("merges host components over the reference kit instead of replacing it", async () => {
    const client = fakeClient();
    const Custom = (): React.ReactElement => <div className="host-stat">custom</div>;
    const host = await render(
      <Ovxa intent="Anything" client={client} components={{ StatCard: Custom }} />,
    );
    await flush();
    expect(host.querySelector(".host-stat")?.textContent).toBe("custom");
    expect(host.querySelector(".ovxa-stat-value")).toBeNull();
  });
});

describe("OvxaSearch", () => {
  it("shows suggestions as an empty state and generates nothing until asked", async () => {
    const client = fakeClient();
    const host = await render(<OvxaSearch client={client} />);
    await flush();

    expect(host.querySelector("form[role=search]")).not.toBeNull();
    const chips = host.querySelectorAll(".ovxa-chip-btn");
    expect(chips).toHaveLength(defaultUseCases.length);
    expect(client.intents).toEqual([]);
    expect(host.querySelector(".ovxa-search-result")).toBeNull();
  });

  it("submits a typed intent and renders the interface underneath", async () => {
    const client = fakeClient();
    const onIntent = vi.fn();
    const host = await render(<OvxaSearch client={client} onIntent={onIntent} />);

    const field = input(host);
    await type(field, "  Show me the health of payments  ");
    await submit(field);

    expect(onIntent).toHaveBeenCalledWith("Show me the health of payments");
    expect(client.intents).toEqual(["Show me the health of payments"]);
    expect(host.querySelector(".ovxa-search-result .ovxa-stat-value")?.textContent).toBe(
      "$91.2k",
    );
    expect(host.querySelector(".ovxa-search-status")?.textContent).toContain("Ready");
  });

  it("filters suggestions as the user types and submits the highlighted one", async () => {
    const client = fakeClient();
    const host = await render(<OvxaSearch client={client} />);
    const field = input(host);
    await type(field, "refund");

    const options = host.querySelectorAll("[role=option]");
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("refund request");
    expect(field.getAttribute("aria-expanded")).toBe("true");

    await key(field, "ArrowDown");
    expect(field.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

    await key(field, "Enter");
    await flush();

    expect(client.intents).toEqual(["Review this refund request and decide"]);
    expect(field.value).toBe("Review this refund request and decide");
  });

  it("Escape clears the box but never the result; Clear resets both", async () => {
    const client = fakeClient();
    const host = await render(<OvxaSearch client={client} defaultIntent="Compare Q2 against Q1" />);
    await flush();
    expect(host.querySelector(".ovxa-search-result")).not.toBeNull();

    const field = input(host);
    await key(field, "Escape");
    expect(field.value).toBe("");
    expect(host.querySelector(".ovxa-search-result")).not.toBeNull();

    const clearButton = host.querySelector<HTMLButtonElement>(".ovxa-search-clear");
    expect(clearButton).not.toBeNull();
    await act(async () => {
      clearButton?.click();
    });
    expect(host.querySelector(".ovxa-search-result")).toBeNull();
    expect(host.querySelectorAll(".ovxa-chip-btn")).toHaveLength(defaultUseCases.length);
  });

  it("offers the Enter hint only when there is something new to submit", async () => {
    const client = fakeClient();
    const host = await render(<OvxaSearch client={client} defaultIntent="Compare Q2 against Q1" />);
    await flush();
    expect(host.querySelector(".ovxa-search-hint")).toBeNull();

    await type(input(host), "Something else");
    expect(host.querySelector(".ovxa-search-hint")).not.toBeNull();
  });

  it("regenerates when the same intent is submitted again", async () => {
    const client = fakeClient();
    const host = await render(<OvxaSearch client={client} defaultIntent="Compare Q2 against Q1" />);
    await flush();
    expect(client.intents).toHaveLength(1);

    await submit(input(host));
    expect(client.intents).toEqual(["Compare Q2 against Q1", "Compare Q2 against Q1"]);
  });

  it("shows a retryable error when the engine fails before a shell arrives", async () => {
    const client: SurfaceSource = {
      async *stream(): AsyncGenerator<SurfaceEvent, unknown> {
        throw new Error("upstream unavailable");
      },
    };
    const host = await render(<OvxaSearch client={client} defaultIntent="Anything" />);
    await flush();

    const alert = host.querySelector("[role=alert]");
    expect(alert?.textContent).toContain("upstream unavailable");
    expect(alert?.querySelector("button")?.textContent).toBe("Try again");
    expect(host.querySelector(".ovxa-search-status")?.textContent).toContain("Failed");
  });
});
