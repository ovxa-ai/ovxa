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
 *
 * Advanced hosts that want the provider split can import `OVXAProvider` and
 * `OVXASurface`. Renderer internals (`FallbackNode`, `SurfaceRenderer`) live
 * on `@ovxa/react`.
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
  OVXAProvider,
  OVXASurface,
  useOvxa,
  useOvxaSurface,
  type OVXAProviderProps,
  type OVXASurfaceProps,
  type SurfaceComponentMap,
  type SurfacePhase,
  type SurfaceSource,
  type UseOvxaSurfaceResult,
} from "@ovxa/react";

export { createSurfaceActions } from "@ovxa/surface-kit";
