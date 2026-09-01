import * as React from "react";
import { createOvxa, type OvxaClient, type OvxaClientOptions } from "@ovxa/client";
import {
  OVXAProvider,
  OVXASurface,
  type OVXASurfaceProps,
  type SurfaceComponentMap,
  type SurfaceSource,
} from "@ovxa/react";
import { createSurfaceActions } from "@ovxa/surface-kit";
import type { ActionRegistry } from "@ovxa/registry";
import { defaultComponents } from "./defaults";

const defaultActions = createSurfaceActions();

export type OvxaProps = OVXASurfaceProps &
  Pick<OvxaClientOptions, "apiKey" | "baseUrl"> & {
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

export type { OvxaClient };
