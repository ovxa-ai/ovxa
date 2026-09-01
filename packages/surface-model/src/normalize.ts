/**
 * Structural repair of a model-authored surface.
 *
 * Every fix here is mechanical: renaming an id that breaks the id charset,
 * dropping a null that should have been an absent key, unwrapping an envelope
 * the model added by habit. Nothing invents data and nothing overrides a
 * decision the model made — that would hide generation quality from the
 * Quality Engine, which is the one thing the compiler must be able to measure.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys the runtime owns. A model-supplied value is discarded, not trusted. */
const RUNTIME_OWNED = ["schemaVersion", "id", "intent", "createdAt", "updatedAt"];

/** Envelope keys models add out of habit when asked for a JSON document. */
const ENVELOPE_KEYS = ["surface", "ui", "result", "output", "response", "data"];

function unwrap(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length !== 1) return value;
  const only = keys[0];
  if (only === undefined || !ENVELOPE_KEYS.includes(only)) return value;
  const inner = value[only];
  return isRecord(inner) && ("root" in inner || "kind" in inner) ? inner : value;
}

function safeId(raw: unknown, fallback: string): string {
  const source = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : fallback;
  const cleaned = source.replace(/[^A-Za-z0-9_:-]/g, "-").replace(/-{2,}/g, "-");
  const trimmed = cleaned.replace(/^-+|-+$/g, "").slice(0, 80);
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Which actions each component type is allowed to expose, taken from the same
 * catalogue the model was shown.
 */
export type ActionAllowlist = ReadonlyMap<string, ReadonlySet<string>>;

function normalizeNode(
  value: unknown,
  seen: Set<string>,
  path: string,
  allowlist: ActionAllowlist | undefined,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (typeof value["type"] !== "string") return null;

  let id = safeId(value["id"], path);
  if (seen.has(id)) {
    let suffix = 2;
    while (seen.has(`${id}-${suffix}`)) suffix += 1;
    id = `${id}-${suffix}`;
  }
  seen.add(id);

  const node: Record<string, unknown> = {
    ...value,
    id,
    props: isRecord(value["props"]) ? value["props"] : {},
  };

  // `null` for an absent optional is the most common shape error models make;
  // the schema is strict, so an explicit null fails where an absent key passes.
  for (const key of ["children", "actions", "a11y", "responsive", "visibleWhen", "slot", "key", "error", "phase"]) {
    if (node[key] === null || node[key] === undefined) delete node[key];
  }

  const children = node["children"];
  if (Array.isArray(children)) {
    const kept = children
      .map((child, index) => normalizeNode(child, seen, `${id}-c${index}`, allowlist))
      .filter((child): child is Record<string, unknown> => child !== null);
    if (kept.length > 0) node["children"] = kept;
    else delete node["children"];
  } else {
    delete node["children"];
  }

  const actions = node["actions"];
  if (Array.isArray(actions)) {
    // The registry invalidates a whole node that names an action its component
    // does not expose. Dropping the action instead costs the user one button;
    // keeping it costs them the entire component.
    const exposed = allowlist?.get(value["type"]);
    const kept = actions
      .filter(isRecord)
      .filter((action) => {
        if (!exposed) return true;
        const id = action["id"];
        return typeof id === "string" && exposed.has(id);
      })
      .map(normalizeAction);
    if (kept.length > 0) node["actions"] = kept;
    else delete node["actions"];
  }

  return node;
}

function isBindingLike(value: unknown): boolean {
  return isRecord(value) && "$bind" in value;
}

/** A state key that satisfies the binding path grammar. */
function stateKeyFor(
  state: Record<string, unknown>,
  nodeId: string,
  prop: string,
): string {
  const base = `${nodeId}_${prop}`.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^(?=\d)/, "_");
  if (!(base in state)) return base;
  let suffix = 2;
  while (`${base}_${suffix}` in state) suffix += 1;
  return `${base}_${suffix}`;
}

/**
 * Move data the model inlined into props out into surface state, and leave a
 * binding behind.
 *
 * Models reliably do both: they put the records in `state` and then paste them
 * into the props as well. A literal prop is a snapshot — the runtime resolves
 * bindings when state changes, so a component holding literals silently stops
 * responding to its own actions. Lifting is what keeps a generated surface
 * live rather than a screenshot of one.
 *
 * Identical data already present in state is reused rather than copied, so the
 * common case collapses back to the binding the model should have written.
 */
function liftLiterals(
  nodes: Array<Record<string, unknown>>,
  state: Record<string, unknown>,
): void {
  const byValue = new Map<string, string>();
  for (const [key, value] of Object.entries(state)) {
    byValue.set(JSON.stringify(value), key);
  }

  const visit = (node: Record<string, unknown>): void => {
    const props = node["props"];
    if (isRecord(props)) {
      for (const [key, value] of Object.entries(props)) {
        if (isBindingLike(value)) continue;
        const isCollection =
          (Array.isArray(value) && value.length > 0) ||
          (isRecord(value) && Object.keys(value).length > 0);
        if (!isCollection) continue;

        const fingerprint = JSON.stringify(value);
        let target = byValue.get(fingerprint);
        if (target === undefined) {
          target = stateKeyFor(state, String(node["id"] ?? "node"), key);
          state[target] = value;
          byValue.set(fingerprint, target);
        }
        props[key] = { $bind: target };
      }
    }
    const children = node["children"];
    if (Array.isArray(children)) {
      for (const child of children) if (isRecord(child)) visit(child);
    }
  };

  for (const node of nodes) visit(node);
}

function normalizeAction(value: Record<string, unknown>): Record<string, unknown> {
  const action: Record<string, unknown> = { ...value };
  if (typeof action["label"] !== "string" || action["label"].length === 0) {
    action["label"] = typeof action["id"] === "string" ? action["id"] : "Continue";
  }
  for (const key of ["confirm", "statusDetail", "description"]) {
    if (action[key] === null || action[key] === undefined) delete action[key];
  }
  if (!Array.isArray(action["optimistic"])) delete action["optimistic"];
  if (!isRecord(action["input"])) delete action["input"];
  return action;
}

/**
 * Bring a model response as close to the OVXA UI Schema as mechanical edits
 * allow. The compiler still validates the result and still owns the verdict.
 */
export function normalizeSurfaceDraft(
  raw: unknown,
  allowlist?: ActionAllowlist,
): Record<string, unknown> | null {
  const value = unwrap(raw);
  if (!isRecord(value)) return null;

  const draft: Record<string, unknown> = { ...value };
  for (const key of RUNTIME_OWNED) delete draft[key];

  const seen = new Set<string>();
  const root = Array.isArray(draft["root"]) ? draft["root"] : [];
  draft["root"] = root
    .map((node, index) => normalizeNode(node, seen, `node-${index + 1}`, allowlist))
    .filter((node): node is Record<string, unknown> => node !== null);

  if (!isRecord(draft["state"])) draft["state"] = {};
  liftLiterals(
    draft["root"] as Array<Record<string, unknown>>,
    draft["state"] as Record<string, unknown>,
  );
  if (!isRecord(draft["layout"])) {
    draft["layout"] = { columns: 2, density: "comfortable", maxWidth: "regular" };
  }

  const actions = draft["actions"];
  draft["actions"] = Array.isArray(actions) ? actions.filter(isRecord).map(normalizeAction) : [];

  // The compiler assigns lifecycle; a model guess here only ever conflicts.
  draft["status"] = "ready";

  if (typeof draft["description"] !== "string") delete draft["description"];
  if (typeof draft["title"] !== "string" || draft["title"].length === 0) {
    delete draft["title"];
  }

  return draft;
}
