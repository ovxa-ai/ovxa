/**
 * OVXA Wire — the compact, streaming-first encoding a model writes.
 *
 * The UI Schema stays the internal representation; Wire is only the wire. Two
 * things make it cheaper than emitting the schema as JSON:
 *
 * Structure. Line-oriented and positional, so the model never reproduces braces,
 * quotes, colons or commas, and never repeats a key it has already used.
 *
 * Data. `@path` binds to host state, so the records a surface renders are never
 * transcribed by the model at all. This is the larger saving by far, and it
 * scales with the size of the data rather than the size of the interface: the
 * same twelve-token chart line serves twelve points or twelve thousand.
 *
 * Streaming falls out of the same design. A newline is a complete unit, so a
 * component is finished the moment the next root-level line arrives — no depth
 * counting, no ambiguity about whether a fragment is parseable yet.
 */
export {
  WIRE_VERSION,
  RESERVED_PROP_KEYS,
  decodeValue,
  parseWireLine,
  type WireLine,
  type WireLineKind,
  type WireValue,
} from "./grammar";

export {
  WireStreamDecoder,
  decodeWire,
  type DecodeResult,
  type WireHeader,
  type WireNode,
  type WireSurfaceDraft,
} from "./decode";

export { encodeSurfaceToWire } from "./encode";

export {
  buildWireCatalog,
  buildWireExample,
  buildWirePrompt,
  buildWireSyntax,
} from "./prompt";
