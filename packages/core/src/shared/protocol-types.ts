/** Extensible protocol type — any non-empty string. Adapters register names at composition time. */
type ProtocolType = string & {};

/** Check if a value is a valid protocol type (any non-empty string). */
function isProtocolType(value: string): value is ProtocolType {
  return value.length > 0;
}

export { type ProtocolType, isProtocolType };
