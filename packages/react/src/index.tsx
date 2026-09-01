import * as React from "react";
import type { ResolvedNode, Surface, SurfaceAction } from "@ovxa/schema";
import type { SurfaceRuntime, RuntimeSnapshot } from "@ovxa/genui-runtime";

/** Props every registered React component receives from the renderer. */
export type SurfaceComponentProps = {
  node: ResolvedNode;
  /** Resolved props: bindings already replaced with live state. */
  data: Record<string, unknown>;
  actions: SurfaceAction[];
  onAction: (actionId: string, input?: Record<string, unknown>) => void;
  children?: React.ReactNode;
};

export type SurfaceComponentMap = Record<
  string,
  React.ComponentType<SurfaceComponentProps>
>;

/**
 * Renders a resolved node tree. A node whose type has no React implementation
 * renders a visible placeholder rather than throwing: one unmapped component
 * must never take down a surface that is otherwise fine.
 */
function RenderNode({
  node,
  map,
  onAction,
}: {
  node: ResolvedNode;
  map: SurfaceComponentMap;
  onAction: (actionId: string, input?: Record<string, unknown>) => void;
}) {
  const Component = map[node.type];
  const children = node.children.map((child) => (
    <RenderNode key={child.key} node={child} map={map} onAction={onAction} />
  ));

  if (!Component) {
    return (
      <div data-ovxa-node-id={node.id} style={{ display: "contents" }}>
        <div className="ovxa-unmapped" role="note">
          <strong>{node.type}</strong>
          <span>No renderer registered for this component.</span>
        </div>
      </div>
    );
  }

  if (node.phase === "error") {
    return (
      <div data-ovxa-node-id={node.id} style={{ display: "contents" }}>
        <div className="ovxa-node-error" role="alert">
          <strong>{node.type} could not load</strong>
          <span>{node.error ?? "The data for this component is unavailable."}</span>
        </div>
      </div>
    );
  }

  if (node.phase === "loading") {
    return (
      <div data-ovxa-node-id={node.id} style={{ display: "contents" }}>
        <div className="ovxa-node-loading" aria-busy="true" aria-live="polite" />
      </div>
    );
  }

  return (
    <div data-ovxa-node-id={node.id} style={{ display: "contents" }}>
      <Component
        node={node}
        data={node.props}
        actions={node.actions ?? []}
        onAction={onAction}
      >
        {children.length > 0 ? children : undefined}
      </Component>
    </div>
  );
}

/**
 * A surface with nothing in it.
 *
 * The compiler produces an explicitly empty surface when nothing could bind,
 * carrying the reason in `description`. Rendering that reason is the difference
 * between a considered empty state and a blank rectangle, so it is the default
 * rather than something each host has to remember to add.
 */
export function SurfaceEmpty({
  surface,
  action,
}: {
  surface: Surface;
  action?: React.ReactNode;
}) {
  return (
    <div className="ovxa-empty-surface" role="status">
      <div className="ovxa-empty-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="4" width="18" height="6" rx="2" />
          <rect x="3" y="14" width="10" height="6" rx="2" />
          <path d="M17 17h4" strokeDasharray="2 2" />
        </svg>
      </div>
      <strong>{surface.title}</strong>
      {surface.description ? <p>{surface.description}</p> : null}
      {action}
    </div>
  );
}

export function SurfaceRenderer({
  tree,
  surface,
  components,
  onAction,
  empty,
  focusRequest,
  theme,
}: {
  tree: ResolvedNode[];
  surface: Surface;
  components: SurfaceComponentMap;
  onAction: (actionId: string, input?: Record<string, unknown>) => void;
  /** Overrides the default empty state. */
  empty?: React.ReactNode;
  focusRequest?: RuntimeSnapshot["focusRequest"];
  /** Learned host tokens, applied as CSS variables on the surface root. */
  theme?: Record<string, string>;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    if (!focusRequest || !rootRef.current) return;
    const escape =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(focusRequest.componentId)
        : focusRequest.componentId.replaceAll(/["\\]/g, "\\$&");
    const component = rootRef.current.querySelector<HTMLElement>(
      `[data-ovxa-node-id="${escape}"]`,
    );
    const target = component?.querySelector<HTMLElement>(
      "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])",
    );
    target?.focus();
  }, [focusRequest]);

  // A surface still streaming has no components yet by design; that is a loading
  // state and belongs to the caller, not here.
  if (tree.length === 0 && surface.status !== "streaming") {
    return <>{empty ?? <SurfaceEmpty surface={surface} />}</>;
  }

  const columns = surface.layout.columns;
  return (
    <div
      ref={rootRef}
      className={`ovxa-surface ovxa-cols-${columns} ovxa-${surface.layout.density}`}
      data-kind={surface.kind}
      {...(theme ? { style: theme as React.CSSProperties } : {})}
    >
      {tree.map((node) => (
        <RenderNode key={node.key} node={node} map={components} onAction={onAction} />
      ))}
    </div>
  );
}

export {
  OVXAProvider,
  OVXASurface,
  useOvxa,
  useOvxaSurface,
  type OVXASurfaceProps,
  type OvxaContextValue,
  type SurfacePhase,
  type SurfaceSource,
  type UseOvxaSurfaceResult,
} from "./embed";

/** Subscribes a component to a runtime and re-renders on every patch. */
export function useSurfaceRuntime(runtime: SurfaceRuntime | null): RuntimeSnapshot | null {
  const [snapshot, setSnapshot] = React.useState<RuntimeSnapshot | null>(
    runtime ? runtime.snapshot : null,
  );

  React.useEffect(() => {
    if (!runtime) {
      setSnapshot(null);
      return;
    }
    return runtime.subscribe(setSnapshot);
  }, [runtime]);

  return snapshot;
}
