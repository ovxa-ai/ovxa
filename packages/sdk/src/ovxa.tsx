import * as React from "react";
import { createOvxa } from "@ovxa/client";
import {
  OVXAProvider,
  OVXASurface,
  type SurfaceComponentMap,
  type SurfaceSource,
} from "@ovxa/react";
import type { ActionRegistry } from "@ovxa/registry";
import type { JsonValue } from "@ovxa/schema";
import { createSurfaceActions } from "@ovxa/surface-kit";
import { defaultComponents } from "./defaults";

const defaultActions = createSurfaceActions();

/**
 * Customer-facing embed props. `data` is the name to use; `state` is the same
 * value kept for existing call sites.
 */
export type OvxaProps = {
  intent: string;
  data?: Record<string, JsonValue>;
  state?: Record<string, JsonValue>;
  locale?: string;
  enabled?: boolean;
  loading?: React.ReactNode;
  empty?: React.ReactNode;
  error?: (message: string, retry: () => void) => React.ReactNode;
  onAction?: (actionId: string, input: Record<string, unknown>) => void;
  className?: string;
  /** Same-origin `/api` is the default. */
  baseUrl?: string;
  /** Server key. Never pass this from a browser bundle. */
  apiKey?: string;
  /** Pass a client you already created. Otherwise one is created from apiKey/baseUrl. */
  client?: SurfaceSource;
  components?: SurfaceComponentMap;
  actions?: ActionRegistry;
};

/**
 * The whole integration.
 *
 *   import { Ovxa } from "@ovxa/sdk";
 *   import "@ovxa/sdk/styles.css";
 *
 *   <Ovxa intent="Compare Q2 revenue against Q1" data={revenue} />
 *
 * Provider, client, reference renderers, actions, streaming, and loading /
 * empty / error states are all included. Swap `components` for your design
 * system when you are ready — until then the surface still renders.
 */
export function Ovxa({
  client,
  apiKey,
  baseUrl,
  components,
  actions,
  ...surface
}: OvxaProps): React.ReactElement {
  const resolvedClient = React.useMemo((): SurfaceSource => {
    if (client) return client;
    return createOvxa({
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    });
  }, [client, apiKey, baseUrl]);

  return (
    <OVXAProvider
      client={resolvedClient}
      components={components ?? defaultComponents}
      actions={actions ?? defaultActions}
    >
      <OVXASurface {...surface} />
    </OVXAProvider>
  );
}
