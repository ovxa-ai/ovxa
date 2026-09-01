import { SurfaceStreamReducer, type SurfaceEvent } from "@ovxa/protocol";
import type { Surface } from "@ovxa/schema";
import type { StreamSummary } from "./client";

export type CollectedSurface = {
  surface: Surface | null;
  summary: StreamSummary | null;
  events: SurfaceEvent[];
  /** Operations the surface refused while folding. Empty on a clean stream. */
  issues: readonly string[];
};

/**
 * Folds a stream into the surface it describes.
 *
 * Streaming and non-streaming are the same code path here, which is the point:
 * a caller that wants progressive rendering iterates the events, and a caller
 * that just wants the result calls this — with no second server route and no
 * risk of the two disagreeing.
 *
 * `onEvent` fires per event, so a caller can drive a progress indicator without
 * having to reimplement the fold.
 */
export async function collectSurface(
  stream: AsyncGenerator<SurfaceEvent, StreamSummary | null>,
  onEvent?: (event: SurfaceEvent, surface: Surface | null) => void,
): Promise<CollectedSurface> {
  const reducer = new SurfaceStreamReducer();
  const events: SurfaceEvent[] = [];

  let next = await stream.next();
  while (!next.done) {
    const event = next.value;
    events.push(event);
    reducer.apply(event);
    onEvent?.(event, reducer.current);
    next = await stream.next();
  }

  return {
    surface: reducer.current,
    summary: next.value,
    events,
    issues: reducer.issues,
  };
}
