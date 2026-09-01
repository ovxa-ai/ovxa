import * as React from "react";
import { SurfaceStreamReducer, type SurfaceEvent } from "@ovxa/protocol";
import type { JsonValue, Surface } from "@ovxa/schema";
import { createActionRegistry, type ActionRegistry } from "@ovxa/registry";
import { createSurfaceRuntime, type SurfaceRuntime } from "@ovxa/genui-runtime";
import { fallbackComponents } from "./fallback";
import { SurfaceRenderer, useSurfaceRuntime, type SurfaceComponentMap } from "./index";

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
 * Streaming, reconciliation, the action loop, and loading, empty and error
 * states are handled here — those are the parts every integration otherwise
 * rewrites and gets subtly wrong.
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
}: OVXAProviderProps) {
  const value = React.useMemo(
    () => ({
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
  /** The shell has not arrived; there is nothing to lay out yet. */
  | { status: "planning" }
  /** A surface exists and is filling in. Render it. */
  | { status: "streaming"; surface: Surface }
  | { status: "ready"; surface: Surface }
  | { status: "error"; message: string; surface: Surface | null };

export type UseOvxaSurfaceResult = {
  phase: SurfacePhase;
  /** Live runtime for the settled surface, or null while still streaming. */
  runtime: SurfaceRuntime | null;
  /** Regenerate from scratch. Cancels anything in flight. */
  regenerate: () => void;
};

/**
 * Streams a surface and keeps it live.
 *
 * The reducer folds events into a surface as they arrive, and a runtime is
 * created once the stream completes so the interaction loop owns the settled
 * surface rather than racing the stream for it.
 */
export function useOvxaSurface({
  intent,
  state,
  locale,
  enabled = true,
}: {
  intent: string;
  state?: Record<string, JsonValue>;
  locale?: string;
  enabled?: boolean;
}): UseOvxaSurfaceResult {
  const { client, actions } = useOvxa();
  const [phase, setPhase] = React.useState<SurfacePhase>({ status: "idle" });
  const [runtime, setRuntime] = React.useState<SurfaceRuntime | null>(null);
  const [nonce, setNonce] = React.useState(0);

  // Serialised so a caller passing a fresh object literal does not re-stream on
  // every render, which would be an expensive and very easy mistake to make.
  const stateKey = React.useMemo(() => JSON.stringify(state ?? null), [state]);

  React.useEffect(() => {
    if (!enabled || intent.trim().length === 0) {
      setPhase({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    let live = true;
    setRuntime(null);
    setPhase({ status: "planning" });

    void (async () => {
      const reducer = new SurfaceStreamReducer();
      try {
        const stream = client.stream({
          intent,
          ...(state ? { state } : {}),
          ...(locale ? { locale } : {}),
          signal: controller.signal,
        });

        let next = await stream.next();
        while (!next.done) {
          reducer.apply(next.value);
          const current = reducer.current;
          if (live && current) setPhase({ status: "streaming", surface: current });
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
        setPhase({ status: "ready", surface: settled });
        setRuntime(createSurfaceRuntime(settled, actions));
      } catch (error) {
        if (!live || controller.signal.aborted) return;
        // Whatever streamed stays on screen: a partly-built interface the user
        // can still read beats replacing it with an error panel.
        setPhase({
          status: "error",
          message: error instanceof Error ? error.message : "Generation failed.",
          surface: reducer.current,
        });
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [client, actions, intent, stateKey, locale, enabled, nonce, state]);

  const regenerate = React.useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { phase, runtime, regenerate };
}

export type OVXASurfaceProps = {
  intent: string;
  /** Application data the surface may bind to. Alias of `data`. */
  state?: Record<string, JsonValue>;
  /** Same as `state`. Prefer this name in product code. */
  data?: Record<string, JsonValue>;
  locale?: string;
  enabled?: boolean;
  /** Rendered while the plan is still being chosen. */
  loading?: React.ReactNode;
  /** Rendered when nothing usable was produced. */
  empty?: React.ReactNode;
  error?: (message: string, retry: () => void) => React.ReactNode;
  onAction?: (actionId: string, input: Record<string, unknown>) => void;
  className?: string;
};

/**
 * A generated interface, streamed and interactive.
 *
 * While streaming, the folded surface is rendered directly — that is what makes
 * components appear one at a time. Once the stream settles, rendering switches to
 * the runtime, so an interaction patches the surface in place and preserves
 * selections, focus and scroll instead of regenerating.
 */
export function OVXASurface({
  intent,
  state,
  data,
  locale,
  enabled,
  loading,
  empty,
  error,
  onAction,
  className,
}: OVXASurfaceProps) {
  const boundState = state ?? data;
  const { components } = useOvxa();
  const { phase, runtime, regenerate } = useOvxaSurface({
    intent,
    ...(boundState ? { state: boundState } : {}),
    ...(locale ? { locale } : {}),
    ...(enabled === undefined ? {} : { enabled }),
  });
  const snapshot = useSurfaceRuntime(runtime);

  const dispatch = React.useCallback(
    (actionId: string, input: Record<string, unknown> = {}) => {
      onAction?.(actionId, input);
      if (!runtime) return;
      void runtime.interact({ actionId, input });
    },
    [runtime, onAction],
  );

  if (phase.status === "idle") return null;

  if (phase.status === "planning") {
    return <>{loading ?? <SurfaceSkeleton />}</>;
  }

  if (phase.status === "error" && !phase.surface) {
    return (
      <>
        {error?.(phase.message, regenerate) ?? (
          <div className="ovxa-error" role="alert">
            <strong>This interface could not be generated</strong>
            <span>{phase.message}</span>
            <button type="button" onClick={regenerate}>
              Try again
            </button>
          </div>
        )}
      </>
    );
  }

  // Prefer the runtime's tree once it exists; before that, render the fold.
  const surface = snapshot?.surface ?? phase.surface;
  if (!surface) return <>{empty ?? null}</>;
  if (surface.root.length === 0 && phase.status === "ready") {
    return <>{empty ?? <SurfaceSkeleton />}</>;
  }

  return (
    <div className={className} data-ovxa-status={surface.status}>
      <SurfaceRenderer
        tree={snapshot?.tree ?? resolveOnce(surface)}
        surface={surface}
        components={components}
        onAction={dispatch}
        {...(snapshot ? { focusRequest: snapshot.focusRequest } : {})}
      />
    </div>
  );
}

/**
 * Resolves a streaming surface for one render.
 *
 * Only used before a runtime exists. The runtime resolves on every patch after
 * that, so this never becomes the hot path.
 */
function resolveOnce(surface: Surface) {
  // Imported lazily through the runtime module to keep one resolver in the tree.
  return createSurfaceRuntime(surface, STREAMING_ACTIONS).snapshot.tree;
}

/**
 * A registry with nothing in it. A streaming surface is not interactive yet, so
 * dispatching from it must fail closed rather than reach a handler.
 */
const STREAMING_ACTIONS = {
  has: () => false,
  get: () => undefined,
  list: () => [],
  ids: () => [],
  register() {
    throw new Error("Cannot register actions on a streaming surface");
  },
  dispatch: async () => ({
    ok: false as const,
    reason: "This surface is still generating",
  }),
} as unknown as ActionRegistry;

function SurfaceSkeleton() {
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
