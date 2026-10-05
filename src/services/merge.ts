import type { ConversionWarning } from "./converter";
import { findUnresolvedReferences } from "./checks";

/** One converted sheet, plus the archive-root-relative path it was uploaded as. */
export interface SheetCrate {
  relativePath: string;
  /** POSIX dirname of relativePath ("" for a root-level sheet). */
  folderPrefix: string;
  crate: unknown;
  warnings: ConversionWarning[];
}

export interface MergeResult {
  crate: unknown;
  warnings: ConversionWarning[];
}

type Entity = Record<string, unknown>;

const DESCRIPTOR_ID = "ro-crate-metadata.json";
const ROOT_ID = "./";
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// Membership/part links are only synthesised between these hierarchy types.
const HIERARCHY_TYPES = new Set([
  "RepositoryCollection",
  "RepositoryObject",
  "File",
]);

// Upward membership term -> its downward inverse (child's term is mirrored).
const INVERSE_TERM: Record<string, string> = {
  isPartOf: "hasPart",
  "pcdm:memberOf": "pcdm:hasMember",
};

function graphOf(crate: unknown): Entity[] {
  const graph = (crate as { "@graph"?: unknown })?.["@graph"];
  return Array.isArray(graph) ? (graph as Entity[]) : [];
}

function typesOf(entity: Entity): string[] {
  const t = entity["@type"];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return typeof t === "string" ? [t] : [];
}

function isHierarchy(entity: Entity | undefined): boolean {
  return !!entity && typesOf(entity).some((t) => HIERARCHY_TYPES.has(t));
}

function isReference(value: unknown): value is { "@id": string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { "@id"?: unknown })["@id"] === "string"
  );
}

// A relative path @id (a File/data entity), as opposed to "./", a "#fragment",
// the descriptor, or an absolute URI. These get folder-prefixed on merge.
function isPathId(id: string): boolean {
  return (
    id !== ROOT_ID &&
    id !== DESCRIPTOR_ID &&
    !id.startsWith("#") &&
    !id.startsWith("/") &&
    !URI_SCHEME.test(id)
  );
}

// Deep-copy `value`, rewriting every {@id} reference through `map`.
function remapRefs(value: unknown, map: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => remapRefs(v, map));
  if (isReference(value)) {
    const id = value["@id"];
    return { "@id": map.get(id) ?? id };
  }
  if (typeof value === "object" && value !== null) {
    const out: Entity = {};
    for (const [k, v] of Object.entries(value as Entity)) {
      out[k] = remapRefs(v, map);
    }
    return out;
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Entity)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

// Ensure `entity[prop]` contains a {@id: refId} reference, deduped. Keeps a lone
// reference scalar when only one remains; promotes to an array when adding more.
function ensureRef(entity: Entity, prop: string, refId: string): void {
  const current = entity[prop];
  const list: unknown[] =
    current === undefined ? [] : Array.isArray(current) ? [...current] : [current];
  if (list.some((r) => isReference(r) && r["@id"] === refId)) return;
  list.push({ "@id": refId });
  entity[prop] = list.length === 1 ? list[0] : list;
}

/**
 * Folds per-sheet crates into a single bundled RO-Crate. The master sheet (its
 * root has no isPartOf/memberOf) keeps "./"; every other sheet's root is demoted
 * to its arcp identifier and linked under the master. File @ids are rebased under
 * each sheet's folder, cross-sheet references resolve after the union, and the
 * inverse membership links are synthesised downward.
 */
export function mergeCrates(sheets: SheetCrate[]): MergeResult {
  // Per-sheet "check" (unresolved-reference) warnings are superseded by the
  // final merged check below, since cross-sheet references only resolve here.
  const perSheetWarnings = sheets.flatMap((s) =>
    s.warnings.filter((w) => w.source !== "check"),
  );
  const mergeWarnings: ConversionWarning[] = [];

  // --- Pass 1: master inference -------------------------------------------
  const rooted = sheets.map((sheet) => {
    const graph = graphOf(sheet.crate);
    const root = graph.find((e) => e["@id"] === ROOT_ID);
    const hasParent =
      !!root && (root["isPartOf"] !== undefined || root["pcdm:memberOf"] !== undefined);
    return { sheet, graph, root, hasParent };
  });

  const masterCandidates = rooted.filter((r) => r.root && !r.hasParent);
  const master = masterCandidates[0] ?? rooted[0];
  if (masterCandidates.length !== 1) {
    mergeWarnings.push({
      source: "merge",
      level: "warning",
      message:
        masterCandidates.length === 0
          ? "No master collection found (every sheet's root declares a parent). Using the first sheet as the master."
          : `Expected exactly one master collection, found ${masterCandidates.length}. Using the first as the master.`,
    });
  }

  const masterArcp =
    typeof master.root?.["identifier"] === "string"
      ? (master.root["identifier"] as string)
      : undefined;

  // --- Pass 2: per-sheet rewrite (@id remap + File rebasing) ---------------
  const mergedEntities: Entity[] = [];
  let masterDescriptor: Entity | undefined;

  for (const { sheet, graph, root, hasParent } of rooted) {
    const isMaster = sheet === master.sheet;

    const sheetArcp =
      typeof root?.["identifier"] === "string" ? (root["identifier"] as string) : undefined;
    if (!isMaster && root && !sheetArcp) {
      mergeWarnings.push({
        source: "merge",
        level: "warning",
        message: `Sub-collection "${sheet.relativePath}" has no identifier; its root cannot be demoted and may collide.`,
      });
    }

    const map = new Map<string, string>();
    // Non-master root "./" is demoted to its arcp identifier.
    if (!isMaster && sheetArcp) map.set(ROOT_ID, sheetArcp);
    // Any reference to the master's arcp resolves to the merged root "./".
    if (masterArcp) map.set(masterArcp, ROOT_ID);
    // Rebase File/data path @ids under this sheet's folder.
    if (sheet.folderPrefix) {
      for (const entity of graph) {
        const id = entity["@id"];
        if (typeof id === "string" && isPathId(id)) {
          map.set(id, `${sheet.folderPrefix}/${id}`);
        }
      }
    }

    for (const entity of graph) {
      const id = entity["@id"];
      if (id === DESCRIPTOR_ID) {
        if (isMaster) masterDescriptor = remapRefs(entity, map) as Entity;
        continue; // non-master descriptors are dropped
      }
      const rewritten = remapRefs(entity, map) as Entity;
      if (typeof id === "string") rewritten["@id"] = map.get(id) ?? id;
      mergedEntities.push(rewritten);
    }

    void hasParent;
  }

  // --- Pass 3 & 4: union + dedupe by @id (last-wins, warn on conflict) -----
  const byId = new Map<string, Entity>();
  for (const entity of mergedEntities) {
    const id = entity["@id"];
    if (typeof id !== "string") continue;
    const existing = byId.get(id);
    if (existing && canonical(existing) !== canonical(entity)) {
      mergeWarnings.push({
        source: "merge",
        level: "warning",
        message: `Conflicting definitions for "${id}"; keeping the last one loaded.`,
        reference: id,
      });
    }
    byId.set(id, entity);
  }

  // --- Pass 5: reverse-link synthesis (downward, hierarchy types only) -----
  for (const entity of byId.values()) {
    if (!isHierarchy(entity)) continue;
    for (const [term, inverse] of Object.entries(INVERSE_TERM)) {
      const value = entity[term];
      if (value === undefined) continue;
      const parents = Array.isArray(value) ? value : [value];
      for (const parentRef of parents) {
        if (!isReference(parentRef)) continue;
        const parent = byId.get(parentRef["@id"]);
        if (!isHierarchy(parent)) continue;
        ensureRef(parent as Entity, inverse, entity["@id"] as string);
      }
    }
  }

  // --- Pass 6: single descriptor -------------------------------------------
  const descriptor: Entity = masterDescriptor ?? {
    "@id": DESCRIPTOR_ID,
    "@type": "CreativeWork",
    about: { "@id": ROOT_ID },
    conformsTo: { "@id": "https://w3id.org/ro/crate/1.2" },
  };
  descriptor["about"] = { "@id": ROOT_ID };
  byId.delete(DESCRIPTOR_ID);

  // --- Pass 7: split-arcp detection (latent landmine, detect only) ---------
  for (const entity of byId.values()) {
    collectRefStrings(entity, (id) => {
      if (/^arcp:\/\/[a-z0-9]+$/i.test(id)) {
        mergeWarnings.push({
          source: "merge",
          level: "warning",
          message: `Reference "${id}" looks like an arcp identifier split on its internal comma. Author arcp values as a single unbracketed cell.`,
          reference: id,
        });
      }
    });
  }

  // --- Pass 8: deterministic order (descriptor, root, then @id asc) --------
  const rest = [...byId.values()].sort((a, b) => {
    const ai = a["@id"] as string;
    const bi = b["@id"] as string;
    if (ai === ROOT_ID) return -1;
    if (bi === ROOT_ID) return 1;
    return ai.localeCompare(bi);
  });
  const graph = [descriptor, ...rest];
  const crate = buildCrate(sheets, master.sheet, graph, mergeWarnings);

  // --- Pass 9: final unresolved-reference check ----------------------------
  const checkWarnings = findUnresolvedReferences(crate);

  return {
    crate,
    warnings: [...perSheetWarnings, ...mergeWarnings, ...checkWarnings],
  };
}

function buildCrate(
  sheets: SheetCrate[],
  master: SheetCrate,
  graph: Entity[],
  warnings: ConversionWarning[],
): unknown {
  return { "@context": mergeContexts(sheets, master, warnings), "@graph": graph };
}

type ContextEntry = string | Record<string, unknown>;

function contextEntries(context: unknown): ContextEntry[] {
  const arr = context === undefined ? [] : Array.isArray(context) ? context : [context];
  return arr.filter(
    (e): e is ContextEntry =>
      typeof e === "string" || (typeof e === "object" && e !== null && !Array.isArray(e)),
  );
}

// Unions every sheet's @context so a shared context tab need only be authored once;
// the master's term definitions win, and a genuine term/URI clash raises one warning.
function mergeContexts(
  sheets: SheetCrate[],
  master: SheetCrate,
  warnings: ConversionWarning[],
): unknown {
  const ordered = [master, ...sheets.filter((s) => s !== master)];
  const strings: string[] = [];
  const terms: Record<string, unknown> = {};

  for (const sheet of ordered) {
    const isMaster = sheet === master;
    const context = (sheet.crate as { "@context"?: unknown })?.["@context"];
    for (const entry of contextEntries(context)) {
      if (typeof entry === "string") {
        if (!strings.includes(entry)) strings.push(entry);
        continue;
      }
      for (const [term, value] of Object.entries(entry)) {
        if (!(term in terms)) {
          terms[term] = value;
        } else if (!isMaster && canonical(terms[term]) !== canonical(value)) {
          warnings.push({
            source: "merge",
            level: "warning",
            message: `Conflicting @context definition for "${term}"; keeping the master's value.`,
            reference: term,
          });
        }
      }
    }
  }

  const result: ContextEntry[] = [...strings];
  if (Object.keys(terms).length > 0) result.push(terms);
  if (result.length === 0) return "https://w3id.org/ro/crate/1.2/context";
  return result.length === 1 ? result[0] : result;
}

function collectRefStrings(value: unknown, onId: (id: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefStrings(item, onId);
  } else if (isReference(value)) {
    onId(value["@id"]);
  } else if (typeof value === "object" && value !== null) {
    for (const nested of Object.values(value as Entity)) {
      collectRefStrings(nested, onId);
    }
  }
}
