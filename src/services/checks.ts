import type { ConversionWarning } from "./converter";

// References with a URI scheme (http:, https:, urn:, arcp:, ...) point outside
// the crate and are never expected in the local graph.
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

interface CrateJson {
  "@graph"?: Array<Record<string, unknown>>;
}

// A reference is an object whose ONLY key is "@id" (an inline node has more).
function isReference(value: unknown): value is { "@id": string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { "@id"?: unknown })["@id"] === "string"
  );
}

function collectRefs(value: unknown, onRef: (id: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, onRef);
  } else if (isReference(value)) {
    onRef(value["@id"]);
  } else if (typeof value === "object" && value !== null) {
    for (const nested of Object.values(value)) collectRefs(nested, onRef);
  }
}

// Flags every {@id} reference that points to an entity not defined in the crate.
// External absolute URIs are ignored; unresolved local ids are reported once
// each with a usage count and an example referrer.
export function findUnresolvedReferences(crate: unknown): ConversionWarning[] {
  const graph = (crate as CrateJson | null)?.["@graph"];
  if (!Array.isArray(graph)) return [];

  const defined = new Set<string>();
  for (const entity of graph) {
    const id = entity["@id"];
    if (typeof id === "string") defined.add(id);
  }

  const unresolved = new Map<string, { count: number; referrer: string }>();
  for (const entity of graph) {
    const from =
      typeof entity["@id"] === "string" ? entity["@id"] : "(unknown)";
    for (const [prop, value] of Object.entries(entity)) {
      if (prop === "@id" || prop === "@type" || prop === "@context") continue;
      collectRefs(value, (refId) => {
        if (defined.has(refId) || URI_SCHEME.test(refId)) return;
        const existing = unresolved.get(refId);
        if (existing) {
          existing.count += 1;
        } else {
          unresolved.set(refId, { count: 1, referrer: `${from} (${prop})` });
        }
      });
    }
  }

  return [...unresolved.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([refId, { count, referrer }]): ConversionWarning => {
      const times = count === 1 ? "once" : `${count} times`;
      return {
        source: "check",
        level: "warning",
        message: `Reference to "${refId}" is not defined in this crate (used ${times}, e.g. from ${referrer}). It may be defined in another sheet or workbook.`,
        reference: refId,
        count,
      };
    });
}
