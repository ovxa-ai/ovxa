import type * as React from "react";
import type { ResolvedNode, SurfaceAction } from "@ovxa/schema";

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
