/**
 * The OVXA SDK.
 *
 *   import { Ovxa } from "@ovxa/sdk";
 *   import "@ovxa/sdk/styles.css";
 *
 *   <Ovxa intent="Compare Q2 against Q1" data={revenue} />
 *
 * That is the whole integration. Streaming, the action loop, and loading /
 * empty / error states are handled. Pass `components` when you want the
 * generated interface to use your design system instead of the reference kit.
 */
export { Ovxa, type OvxaProps } from "./ovxa";
export { defaultComponents } from "./defaults";

export {
  OvxaError,
  collectSurface,
  createOvxa,
  type ActResult,
  type CollectedSurface,
  type GenerateRequest,
  type GenerateResult,
  type OvxaClient,
  type OvxaClientOptions,
  type StreamSummary,
  type SurfaceRecordView,
  type VisualizeRequest,
} from "@ovxa/client";

export {
  ActionBar,
  FallbackNode,
  OVXAProvider,
  OVXASurface,
  SurfaceEmpty,
  SurfaceRenderer,
  fallbackComponents,
  useOvxa,
  useOvxaSurface,
  useSurfaceRuntime,
  type OVXAProviderProps,
  type OVXASurfaceProps,
  type OvxaContextValue,
  type SurfaceComponentMap,
  type SurfaceComponentProps,
  type SurfacePhase,
  type SurfaceSource,
  type UseOvxaSurfaceResult,
} from "@ovxa/react";

export { createSurfaceActions, createSurfaceRegistry } from "@ovxa/surface-kit";
