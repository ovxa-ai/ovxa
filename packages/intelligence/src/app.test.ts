import { describe, expect, it } from "vitest";
import {
  describeAppForPrompt,
  hostSnapshotFromLearning,
  learnApp,
  matchFlows,
  ovxaVisualContract,
  productKnowledgeFromGraph,
  suggestedIntents,
} from "./app";

const acme = productKnowledgeFromGraph({
  application: { name: "Acme Cloud" },
  pages: [{ name: "customers" }, { name: "recovery" }],
  entities: [{ name: "customer" }, { name: "invoice" }],
  workflows: [
    {
      id: "workflow:account-recovery",
      name: "Account recovery",
      capabilityIds: ["customer.inspect", "customer.refund"],
    },
    {
      id: "workflow:plan-compare",
      name: "Compare support plans",
      capabilityIds: ["plan.list", "plan.select"],
    },
  ],
  capabilities: [
    {
      name: "customer.inspect",
      capability: {
        id: "customer.inspect",
        action: "inspect",
        entity: "customer",
        risk: "READ",
        requiredPermissions: ["customers.read"],
      },
    },
    {
      name: "customer.refund",
      capability: {
        id: "customer.refund",
        action: "refund",
        entity: "customer",
        risk: "HIGH_RISK_WRITE",
        requiredPermissions: ["customers.refund"],
      },
    },
    {
      name: "plan.list",
      capability: {
        id: "plan.list",
        action: "list",
        entity: "plan",
        risk: "READ",
        requiredPermissions: [],
      },
    },
    {
      name: "plan.select",
      capability: {
        id: "plan.select",
        action: "select",
        entity: "plan",
        risk: "LOW_RISK_WRITE",
        requiredPermissions: [],
      },
    },
  ],
});

const operator = {
  id: "usr_1",
  name: "Maya Chen",
  role: "operator",
  permissions: ["customers.read"],
};

describe("learnApp", () => {
  it("does not pretend OVXA is the customer app when the host has not been observed", () => {
    const app = learnApp({ intent: "Show me why revenue dropped" });
    expect(app.visual).toEqual(ovxaVisualContract());
    expect(app.productName).toBe("");
    expect(app.observed).toBe(false);
    expect(app.visualSource).toBe("fallback");
    expect(app.visual.density).toBe("compact");
    expect(app.visual.accent).toBe("#fafafa");
  });

  it("learns product flows, vocabulary, and the signed-in user", () => {
    const app = learnApp({
      intent: "Recover this at-risk customer",
      product: acme,
      user: operator,
    });
    expect(app.productName).toBe("Acme Cloud");
    expect(app.observed).toBe(true);
    expect(app.visualSource).toBe("fallback");
    expect(app.user?.name).toBe("Maya Chen");
    expect(app.vocabulary).toEqual(
      expect.arrayContaining(["customers", "customer", "inspect customer"]),
    );
    expect(app.matchedFlows[0]?.name).toBe("Account recovery");
    expect(app.matchedFlows[0]?.suggestedKind).toBe("workflow");
    // Operator cannot refund — that step is omitted from the learned flow.
    expect(app.matchedFlows[0]?.steps.join(" ")).toContain("inspect customer");
    expect(app.matchedFlows[0]?.steps.join(" ")).not.toContain("refund");
  });

  it("keeps refund in the flow when the user is allowed to perform it", () => {
    const app = learnApp({
      intent: "Refund this customer",
      product: acme,
      user: {
        ...operator,
        role: "workspace_admin",
        permissions: ["customers.read", "customers.refund"],
      },
    });
    expect(app.matchedFlows[0]?.steps.join(" ")).toContain("refund customer");
  });

  it("suggests generative intents that sound like the product, not a kit", () => {
    const app = learnApp({ intent: "", product: acme, user: operator });
    const intents = suggestedIntents(app);
    expect(intents.some((intent) => /account recovery/i.test(intent))).toBe(true);
    expect(intents.join(" ")).not.toMatch(/lorem|item 1|dashboard widget/i);
  });
});

describe("describeAppForPrompt", () => {
  it("puts the customer app, user, vocabulary and matched flows in the generation prompt", () => {
    const app = learnApp({
      intent: "Walk the customer through recovery",
      product: acme,
      user: operator,
    });
    const prompt = describeAppForPrompt(app);
    expect(prompt).toContain("CUSTOMER APPLICATION");
    expect(prompt).toContain("Acme Cloud");
    expect(prompt).toContain("Maya Chen");
    expect(prompt).toContain("operator");
    expect(prompt).toContain("MATCHED PRODUCT FLOWS");
    expect(prompt).toContain("Account recovery");
    expect(prompt).toContain("customers");
    expect(prompt).toContain("kit demos");
    expect(prompt).not.toContain("APP STYLE");
    expect(prompt).not.toContain("gradient");
  });

  it("refuses to treat an unobserved host as OVXA or a kit demo", () => {
    const prompt = describeAppForPrompt(learnApp({ intent: "Show me revenue" }));
    expect(prompt).toContain("CUSTOMER APPLICATION: not observed yet");
    expect(prompt).not.toContain("product: OVXA");
    expect(prompt).toContain("kit demos");
  });

  it("lists host tokens only when they were captured on the customer app", () => {
    const withVisual = learnApp({
      intent: "",
      product: {
        ...acme,
        visual: ovxaVisualContract(),
      },
    });
    expect(withVisual.visualSource).toBe("host");
    expect(describeAppForPrompt(withVisual)).toContain("density: compact");
    expect(describeAppForPrompt(learnApp({ intent: "", product: acme }))).toContain(
      "visual: not yet captured",
    );
  });
});

describe("hostSnapshotFromLearning", () => {
  it("exposes customer nouns for generation when the app was observed", () => {
    const app = learnApp({ intent: "", product: acme });
    const snapshot = hostSnapshotFromLearning(app);
    expect(snapshot?.product).toBe("Acme Cloud");
    expect(snapshot?.flows.some((flow) => flow.name === "Account recovery")).toBe(
      true,
    );
    expect(hostSnapshotFromLearning(learnApp({ intent: "" }))).toBeUndefined();
  });
});

describe("matchFlows", () => {
  it("scores a comparison workflow above recovery for a choose intent", () => {
    const app = learnApp({ intent: "", product: acme });
    const matched = matchFlows(app.flows, "Help me choose a support plan");
    expect(matched[0]?.name).toBe("Compare support plans");
    expect(matched[0]?.suggestedKind).toBe("comparison");
  });
});
