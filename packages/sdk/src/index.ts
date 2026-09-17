/**
 * The OVXA SDK.
 *
 *   import { Ovxa, OvxaSearch } from "@ovxa/sdk";
 *   import "@ovxa/sdk/styles.css";
 *
 *   <Ovxa intent="Compare Q2 against Q1" data={revenue} />
 *   <OvxaSearch data={workspace} />
 *
 * `Ovxa` renders one intent. `OvxaSearch` lets the user type the intent and
 * renders the answer underneath. Streaming, the action loop, and loading /
 * empty / error states are handled by both. The generated interface inherits
 * the host's colour and type; pass `theme` or set `--ovxa-*` custom properties
 * to tune the rest, and `components` to render with your own design system.
 *
 * Advanced hosts that want the provider split can import `OVXAProvider`,
 * `useOvxaSurface` and `OVXASurfaceView`. Renderer internals (`FallbackNode`,
 * `SurfaceRenderer`) live on `@ovxa/react`.
 */
export { Ovxa, OvxaRoot, type OvxaConnectionProps, type OvxaProps } from "./ovxa";
export { OvxaSearch, type OvxaSearchProps } from "./search";
export { defaultUseCases, filterUseCases, type UseCase } from "./use-cases";
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
  OVXASurfaceView,
  useOvxa,
  useOvxaSurface,
  type OVXAProviderProps,
  type OVXASurfaceProps,
  type OVXASurfaceViewProps,
  type OvxaTheme,
  type SurfaceComponentMap,
  type SurfaceComponentProps,
  type SurfacePhase,
  type SurfaceSource,
  type SurfaceViewProps,
  type UseOvxaSurfaceResult,
} from "@ovxa/react";

export { createSurfaceActions } from "@ovxa/surface-kit";
