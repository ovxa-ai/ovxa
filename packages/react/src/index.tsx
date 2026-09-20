export type { SurfaceComponentMap, SurfaceComponentProps } from "./types.js";

export {
  SurfaceEmpty,
  SurfaceRenderer,
  useSurfaceRuntime,
  type SurfaceRendererProps,
} from "./renderer.js";

export {
  OVXAProvider,
  OVXASurface,
  OVXASurfaceView,
  SurfaceSkeleton,
  useOvxa,
  useOvxaSurface,
  type OVXAProviderProps,
  type OVXASurfaceProps,
  type OVXASurfaceViewProps,
  type OvxaContextValue,
  type SurfacePhase,
  type SurfaceSource,
  type SurfaceViewProps,
  type UseOvxaSurfaceOptions,
  type UseOvxaSurfaceResult,
} from "./embed.js";

export { ActionBar, FallbackNode, fallbackComponents } from "./fallback.js";

export { cx, themeStyle, type OvxaTheme } from "./theme.js";
