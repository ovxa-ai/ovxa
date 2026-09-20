import * as React from "react";
import { createOvxa } from "@ovxa/client";
import {
  OVXAProvider,
  OVXASurface,
  type OVXASurfaceProps,
  type SurfaceComponentMap,
  type SurfaceSource,
} from "@ovxa/react";
import type { ActionRegistry } from "@ovxa/registry";
import { createSurfaceActions } from "@ovxa/surface-kit";
import { defaultComponents } from "./defaults.js";

const defaultActions = createSurfaceActions();

/** How the embed reaches the engine and what it renders with. */
export type OvxaConnectionProps = {
  /** Same-origin `/api` is the default. */
  baseUrl?: string;
  /** Server key. Never pass this from a browser bundle. */
  apiKey?: string;
  /** Pass a client you already created. Otherwise one is created from apiKey/baseUrl. */
  client?: SurfaceSource;
  /** Your design system. Unmapped types still render through the reference kit. */
  components?: SurfaceComponentMap;
  actions?: ActionRegistry;
};

/**
 * Customer-facing embed props. `data` is the name to use; `state` is the same
 * value kept for existing call sites.
 */
export type OvxaProps = OvxaConnectionProps & OVXASurfaceProps;

/**
 * Provider with the SDK defaults applied: a client from `baseUrl`/`apiKey`,
 * the reference renderers, and the reference action allowlist.
 */
export function OvxaRoot({
  client,
  apiKey,
  baseUrl,
  components,
  actions,
  children,
}: OvxaConnectionProps & { children: React.ReactNode }): React.ReactElement {
  const resolvedClient = React.useMemo((): SurfaceSource => {
    if (client) return client;
    return createOvxa({
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    });
  }, [client, apiKey, baseUrl]);

  const mergedComponents = React.useMemo(
    (): SurfaceComponentMap => (components ? { ...defaultComponents, ...components } : defaultComponents),
    [components],
  );

  return (
    <OVXAProvider
      client={resolvedClient}
      components={mergedComponents}
      actions={actions ?? defaultActions}
    >
      {children}
    </OVXAProvider>
  );
}

/**
 * The whole integration.
 *
 *   import { Ovxa } from "@ovxa/sdk";
 *   import "@ovxa/sdk/styles.css";
 *
 *   <Ovxa intent="Compare Q2 revenue against Q1" data={revenue} />
 *
 * Provider, client, reference renderers, actions, streaming, and loading /
 * empty / error states are all included. Pass `components` to render with your
 * design system; anything you do not map keeps the reference renderer.
 */
export function Ovxa({
  client,
  apiKey,
  baseUrl,
  components,
  actions,
  ...surface
}: OvxaProps): React.ReactElement {
  return (
    <OvxaRoot
      {...(client ? { client } : {})}
      {...(apiKey ? { apiKey } : {})}
      {...(baseUrl ? { baseUrl } : {})}
      {...(components ? { components } : {})}
      {...(actions ? { actions } : {})}
    >
      <OVXASurface {...surface} />
    </OvxaRoot>
  );
}
