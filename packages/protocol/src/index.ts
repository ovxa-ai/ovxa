/**
 * Transport-independent streaming protocol for generated surfaces. The same
 * event sequence drives live rendering, replay and evaluation.
 */
export {
  isTerminalEvent,
  parseSurfaceEvent,
  safeParseSurfaceEvent,
  surfaceEventSchema,
  type SurfaceEvent,
  type SurfaceEventType,
} from "./events";

export {
  SurfaceEventEmitter,
  SurfaceStreamReducer,
  decodeSurfaceEvent,
  encodeSurfaceEvent,
  type ApplyOutcome,
  type SurfaceEventInput,
} from "./stream";
