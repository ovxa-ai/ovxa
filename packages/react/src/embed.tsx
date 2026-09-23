import * as React from "react";
import { SurfaceStreamReducer, type SurfaceEvent } from "@ovxa/protocol";
import { resolveSurface, type JsonValue, type ResolvedNode, type Surface } from "@ovxa/schema";
import { createActionRegistry, type ActionRegistry } from "@ovxa/registry";
import { createSurfaceRuntime, type SurfaceRuntime } from "@ovxa/genui-runtime";
import { fallbackComponents } from "./fallback.js";
import {
  SurfaceEmpty,
  SurfaceRenderer,
  useSurfaceRuntime,
  type SurfaceComponentMap,
} from "./renderer.js";
import { cx, themeStyle, type OvxaTheme } from "./theme.js";

/**
 * The embed layer: one component that turns an intent into a live interface.
 *
 *   const ovxa = createOvxa({ baseUrl: "/api" });
 *
 *   <OVXAProvider client={ovxa}>
 *     <OVXASurface intent="Compare Q2 revenue against Q1" data={revenue} />
 *   </OVXAProvider>
 *
 * Components and actions are optional. Missing renderers still show the data.
 */

/** The slice of the client this layer needs. Keeps React free of the transport. */
export type SurfaceSource = {
  stream(request: {
    intent: string;
    state?: Record<string, JsonValue>;
    locale?: string;
    signal?: AbortSignal;
  }): AsyncGenerator<SurfaceEvent, unknown>;
};

export type OvxaContextValue = {
  client: SurfaceSource;
  components: SurfaceComponentMap;
  actions: ActionRegistry;
};

export type OVXAProviderProps = {
  client: SurfaceSource;
  /** Host design-system map. Unmapped types still render as structured HTML. */
  components?: SurfaceComponentMap;
  /** Host action handlers. Defaults to an empty allowlist. */
  actions?: ActionRegistry;
  children: React.ReactNode;
};

const OvxaContext = React.createContext<OvxaContextValue | null>(null);

const DEFAULT_ACTIONS = createActionRegistry();

export function OVXAProvider({
  client,
  components,
  actions,
  children,
}: OVXAProviderProps): React.ReactElement {
  const value = React.useMemo(
    (): OvxaContextValue => ({
      client,
      components: components ?? fallbackComponents,
      actions: actions ?? DEFAULT_ACTIONS,
    }),
    [client, components, actions],
  );
  return <OvxaContext.Provider value={value}>{children}</OvxaContext.Provider>;
}

export function useOvxa(): OvxaContextValue {
  const value = React.useContext(OvxaContext);
  if (!value) {
    throw new Error("useOvxa must be used inside an <OVXAProvider>");
  }
  return value;
}

export type SurfacePhase =
  | { status: "idle" }
  | { status: "planning" }
  | { status: "streaming"; surface: Surface; tree: ResolvedNode[] }
  | { status: "ready"; surface: Surface; tree: ResolvedNode[] }
  | { status: "error"; message: string; surface: null }
  | { status: "error"; message: string; surface: Surface; tree: ResolvedNode[] };

export type UseOvxaSurfaceResult = {
  phase: SurfacePhase;
  /** Live runtime for the settled surface, or null while still streaming. */
  runtime: SurfaceRuntime | null;
  /** Regenerate from scratch. Cancels anything in flight. */
  regenerate: () => void;
  /**
   * Ask for the next interface. A click that changes the question — opening
   * one account, confirming a refund — comes back through here.
   */
  follow: (intent: string) => void;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The next question a click is asking, or null when the click only edits state. */
export function nextIntent(
  title: string,
  intent: string,
  actionId: string,
  input: Record<string, unknown>,
): string | null {
  if (actionId === "drillDown") {
    const subject = text(input["label"]) || text(input["id"]);
    if (!subject) return null;
    return `Investigate ${subject} in detail and explain what is driving it`;
  }
  if (actionId === "selectOption") {
    const choice = text(input["label"]) || text(input["id"]);
    if (!choice) return null;
    return `The user chose ${choice}. ${intent} Show what that choice changes.`;
  }
  if (actionId === "confirm" || actionId === "submit" || actionId === "approve") {
    const decision = title.trim() || intent.trim();
    if (!decision) return null;
    return `The decision is made: ${decision}. Show the outcome and what is left to do.`;
  }
  if (actionId === "dismiss") {
    const decision = title.trim() || intent.trim();
    if (!decision) return null;
    return `The user set this aside: ${decision}. Show the next decision.`;
  }
  return null;
}

export type UseOvxaSurfaceOptions = {
  intent: string;
  state?: Record<string, JsonValue>;
  locale?: string;
  enabled?: boolean;
};

/**
 * Streams a surface and keeps it live.
 *
 * The reducer folds events into a surface as they arrive. Bindings are resolved
 * in this effect — not during render — so a parent re-render does not redo that
 * work. A runtime is created once the stream completes so the interaction loop
 * owns the settled surface rather than racing the stream for it.
 */
export function useOvxaSurface({
  intent,
  state,
  locale,
  enabled = true,
}: UseOvxaSurfaceOptions): UseOvxaSurfaceResult {
  const { client, actions } = useOvxa();
  const [phase, setPhase] = React.useState<SurfacePhase>({ status: "idle" });
  const [runtime, setRuntime] = React.useState<SurfaceRuntime | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [followed, setFollowed] = React.useState<string | null>(null);
  const seenIntent = React.useRef(intent);
  if (seenIntent.current !== intent) {
    seenIntent.current = intent;
    if (followed !== null) setFollowed(null);
  }
  const requested = (followed ?? intent).trim();
  const stateRef = React.useRef(state);
  stateRef.current = state;

  // Serialised so a caller passing a fresh object literal does not re-stream on
  // every render, which would be an expensive and very easy mistake to make.
  const stateKey = React.useMemo(() => JSON.stringify(state ?? null), [state]);

  React.useEffect(() => {
    if (!enabled || requested.length === 0) {
      setPhase({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    let live = true;
    const boundState = stateRef.current;
    setRuntime(null);
    setPhase({ status: "planning" });

    void (async () => {
      const reducer = new SurfaceStreamReducer();
      try {
        const stream = client.stream({
          intent: requested,
          ...(boundState ? { state: boundState } : {}),
          ...(locale ? { locale } : {}),
          signal: controller.signal,
        });

        let next = await stream.next();
        while (!next.done) {
          reducer.apply(next.value);
          const current = reducer.current;
          if (live && current) {
            setPhase({
              status: "streaming",
              surface: current,
              tree: resolveSurface(current),
            });
          }
          next = await stream.next();
        }

        if (!live) return;
        const settled = reducer.current;
        if (!settled) {
          setPhase({
            status: "error",
            message: "Generation produced no surface.",
            surface: null,
          });
          return;
        }
        setPhase({
          status: "ready",
          surface: settled,
          tree: resolveSurface(settled),
        });
        setRuntime(createSurfaceRuntime(settled, actions));
      } catch (error) {
        if (!live || controller.signal.aborted) return;
        const current = reducer.current;
        if (current) {
          setPhase({
            status: "error",
            message: error instanceof Error ? error.message : "Generation failed.",
            surface: current,
            tree: resolveSurface(current),
          });
          return;
        }
        setPhase({
          status: "error",
          message: error instanceof Error ? error.message : "Generation failed.",
          surface: null,
        });
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [client, actions, requested, stateKey, locale, enabled, nonce]);

  const regenerate = React.useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const follow = React.useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (trimmed.length === 0) return;
      setFollowed((current) => {
        const active = (current ?? intent).trim();
        return trimmed === active ? current : trimmed;
      });
      setNonce((value) => value + 1);
    },
    [intent],
  );

  return { phase, runtime, regenerate, follow };
}

/** Presentation props shared by `OVXASurface` and `OVXASurfaceView`. */
export type SurfaceViewProps = {
  /** Rendered while the plan is still being chosen. */
  loading?: React.ReactNode;
  /** Rendered when nothing usable was produced. */
  empty?: React.ReactNode;
  error?: (message: string, retry: () => void) => React.ReactNode;
  onAction?: (actionId: string, input: Record<string, unknown>) => void;
  className?: string;
  /** Host design tokens. Also settable as `--ovxa-*` custom properties in CSS. */
  theme?: OvxaTheme;
};

export type OVXASurfaceProps = SurfaceViewProps & {
  intent: string;
  /** Application data the surface may bind to. Alias of `data`. */
  state?: Record<string, JsonValue>;
  /** Same as `state`. Prefer this name in product code. */
  data?: Record<string, JsonValue>;
  locale?: string;
  enabled?: boolean;
};

/**
 * A generated interface, streamed and interactive.
 *
 * Owns the stream. Hosts that want to drive the stream themselves — to show
 * its status elsewhere, or to prefetch — call `useOvxaSurface` and render the
 * result with `OVXASurfaceView`.
 */
export function OVXASurface({
  intent,
  state,
  data,
  locale,
  enabled,
  ...view
}: OVXASurfaceProps): React.ReactElement | null {
  const boundState = state ?? data;
  const result = useOvxaSurface({
    intent,
    ...(boundState ? { state: boundState } : {}),
    ...(locale ? { locale } : {}),
    ...(enabled === undefined ? {} : { enabled }),
  });
  return <OVXASurfaceView {...result} {...view} />;
}

export type OVXASurfaceViewProps = SurfaceViewProps & UseOvxaSurfaceResult;

/**
 * Renders the result of `useOvxaSurface`.
 *
 * While streaming, the folded surface is rendered directly — that is what makes
 * components appear one at a time. Once the stream settles, rendering switches to
 * the runtime, so an interaction patches the surface in place and preserves
 * selections, focus and scroll instead of regenerating.
 *
 * Every state renders inside one `.ovxa` root so host tokens apply to the
 * skeleton and the error exactly as they apply to the surface.
 */
export function OVXASurfaceView({
  phase,
  runtime,
  regenerate,
  follow,
  loading,
  empty,
  error,
  onAction,
  className,
  theme,
}: OVXASurfaceViewProps): React.ReactElement | null {
  const { components } = useOvxa();
  const snapshot = useSurfaceRuntime(runtime);

  const dispatch = React.useCallback(
    (actionId: string, input: Record<string, unknown> = {}) => {
      onAction?.(actionId, input);
      const current =
        snapshot?.surface ??
        (phase.status === "streaming" || phase.status === "ready" || phase.status === "error"
          ? phase.surface
          : null);
      if (!current) return;
      const advance = (result?: { status: string; intent?: string }) => {
        if (result?.status === "recompile" && result.intent) {
          follow(result.intent);
          return;
        }
        if (result?.status === "needs-confirmation") return;
        const next = nextIntent(current.title, current.intent, actionId, input);
        if (next) follow(next);
      };
      // Rows appear while the document is still streaming. A click then has no
      // runtime yet, and waiting for one makes the row look dead.
      if (!runtime) {
        advance();
        return;
      }
      void runtime.interact({ actionId, input }).then(advance);
    },
    [runtime, onAction, snapshot, phase, follow],
  );

  if (phase.status === "idle") return null;

  const style = themeStyle(theme);
  const root = (status: string, children: React.ReactNode): React.ReactElement => (
    <div
      className={cx("ovxa", className)}
      data-ovxa-status={status}
      {...(style ? { style } : {})}
    >
      {children}
    </div>
  );

  if (phase.status === "planning") {
    return root("planning", loading ?? <SurfaceSkeleton />);
  }

  if (phase.status === "error" && phase.surface === null) {
    return root(
      "error",
      error?.(phase.message, regenerate) ?? (
        <div className="ovxa-error" role="alert">
          <strong>This interface could not be generated</strong>
          <span>{phase.message}</span>
          <button type="button" className="ovxa-btn" onClick={regenerate}>
            Try again
          </button>
        </div>
      ),
    );
  }

  const surface = snapshot?.surface ?? phase.surface;
  if (!surface) return root("empty", empty ?? null);
  if (surface.root.length === 0 && phase.status === "ready") {
    return root("empty", empty ?? <SurfaceEmpty surface={surface} />);
  }

  const tree = snapshot?.tree ?? ("tree" in phase ? phase.tree : []);

  return root(
    surface.status,
    <SurfaceRenderer
      tree={tree}
      surface={surface}
      components={components}
      onAction={dispatch}
      {...(snapshot ? { focusRequest: snapshot.focusRequest } : {})}
    />,
  );
}

/** Layout-shaped placeholder shown while a plan is being chosen. */
export function SurfaceSkeleton(): React.ReactElement {
  return (
    <div className="ovxa-skeleton" aria-busy="true" aria-live="polite">
      <span className="ovxa-sk ovxa-sk-title" />
      <span className="ovxa-sk ovxa-sk-line" />
      <div className="ovxa-sk-grid">
        <span className="ovxa-sk ovxa-sk-card" />
        <span className="ovxa-sk ovxa-sk-card" />
        <span className="ovxa-sk ovxa-sk-card" />
      </div>
    </div>
  );
}
