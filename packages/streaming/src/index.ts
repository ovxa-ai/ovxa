/**
 * Generation as a stream.
 *
 * The compiler decides what a surface should be; this package decides when the
 * user gets to see it. A planned shell goes out before generation starts, each
 * component goes out as it validates, and a final reconcile patch settles the
 * surface without discarding what the user is already interacting with.
 */
export {
  IncrementalSurfaceParser,
  type IncrementalHeader,
  type IncrementalYield,
} from "./incremental";

export {
  collectStream,
  streamSurface,
  type StreamOptions,
  type StreamResult,
} from "./stream";

export {
  SSE_HEADERS,
  SseDecoder,
  encodeSseEvent,
  readSurfaceEventStream,
} from "./transport";
