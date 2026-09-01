/**
 * The OVXA client.
 *
 *   const ovxa = createOvxa({ apiKey: process.env.OVXA_API_KEY });
 *
 *   // One call, one surface.
 *   const { surface } = await ovxa.generate({ intent, state });
 *
 *   // Or stream it, and render while it is still being written.
 *   for await (const event of ovxa.stream({ intent, state })) { ... }
 *
 *   // Data you already have, no second model call to decide how to show it.
 *   const { surface } = await ovxa.visualize({ intent, data });
 *
 * Everything is typed against the same schema the compiler validates, so a
 * surface that reaches this client has already been grounded against the host's
 * registry — there is no client-side trust boundary to get wrong.
 */
export {
  OvxaError,
  createOvxa,
  type ActResult,
  type GenerateRequest,
  type GenerateResult,
  type OvxaClient,
  type OvxaClientOptions,
  type StreamSummary,
  type SurfaceRecordView,
  type VisualizeRequest,
} from "./client";

export { collectSurface, type CollectedSurface } from "./collect";
