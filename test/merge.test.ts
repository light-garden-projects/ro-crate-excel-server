import { describe, expect, it } from "vitest";
import { mergeCrates, type SheetCrate } from "../src/services/merge";

type Entity = Record<string, unknown>;

function sheet(
  relativePath: string,
  folderPrefix: string,
  graph: Entity[],
): SheetCrate {
  return {
    relativePath,
    folderPrefix,
    warnings: [],
    crate: {
      "@context": "https://w3id.org/ro/crate/1.2/context",
      "@graph": [
        { "@id": "ro-crate-metadata.json", "@type": "CreativeWork", about: { "@id": "./" } },
        ...graph,
      ],
    },
  };
}

function graphOf(result: { crate: unknown }): Entity[] {
  return (result.crate as { "@graph": Entity[] })["@graph"];
}

function byId(result: { crate: unknown }, id: string): Entity | undefined {
  return graphOf(result).find((e) => e["@id"] === id);
}

const MASTER_ARCP = "arcp://uuid,11111111-1111-1111-1111-111111111111/";
const SUB_ARCP = "arcp://uuid,22222222-2222-2222-2222-222222222222/";

describe("mergeCrates", () => {
  it("keeps the master root at './' and demotes sub-collections to their arcp id", () => {
    const master = sheet("root.xlsx", "", [
      { "@id": "./", "@type": ["Dataset", "RepositoryCollection"], identifier: MASTER_ARCP },
    ]);
    const sub = sheet("Sub/metadata.xlsx", "Sub", [
      {
        "@id": "./",
        "@type": ["Dataset", "RepositoryCollection"],
        identifier: SUB_ARCP,
        isPartOf: { "@id": MASTER_ARCP },
      },
    ]);

    const result = mergeCrates([master, sub]);

    const root = byId(result, "./");
    expect(root?.["identifier"]).toBe(MASTER_ARCP);
    const demoted = byId(result, SUB_ARCP);
    expect(demoted).toBeDefined();
    // Sub's isPartOf -> master arcp is rewritten to the merged root "./".
    expect(demoted?.["isPartOf"]).toEqual({ "@id": "./" });
  });

  it("synthesises the downward inverse link on the parent (mirroring the child term)", () => {
    const master = sheet("root.xlsx", "", [
      { "@id": "./", "@type": ["Dataset", "RepositoryCollection"], identifier: MASTER_ARCP },
    ]);
    const sub = sheet("Sub/metadata.xlsx", "Sub", [
      {
        "@id": "./",
        "@type": ["Dataset", "RepositoryCollection"],
        identifier: SUB_ARCP,
        isPartOf: { "@id": MASTER_ARCP },
      },
      {
        "@id": "#obj1",
        "@type": "RepositoryObject",
        "pcdm:memberOf": { "@id": "./" },
      },
    ]);

    const result = mergeCrates([master, sub]);

    // isPartOf child -> parent gets hasPart.
    expect(byId(result, "./")?.["hasPart"]).toEqual({ "@id": SUB_ARCP });
    // pcdm:memberOf child -> parent gets pcdm:hasMember.
    expect(byId(result, SUB_ARCP)?.["pcdm:hasMember"]).toEqual({ "@id": "#obj1" });
    // The object's memberOf "./" was remapped to the sub's arcp.
    expect(byId(result, "#obj1")?.["pcdm:memberOf"]).toEqual({ "@id": SUB_ARCP });
  });

  it("does not synthesise membership onto contextual entities", () => {
    const master = sheet("root.xlsx", "", [
      { "@id": "./", "@type": ["Dataset", "RepositoryCollection"], identifier: MASTER_ARCP },
      { "@id": "#person1", "@type": "Person", name: "Ada" },
    ]);

    const result = mergeCrates([master]);

    const person = byId(result, "#person1");
    expect(person?.["pcdm:hasMember"]).toBeUndefined();
    expect(person?.["hasPart"]).toBeUndefined();
  });

  it("rebases File path @ids under the sheet's folder prefix", () => {
    const master = sheet("root.xlsx", "", [
      { "@id": "./", "@type": ["Dataset", "RepositoryCollection"], identifier: MASTER_ARCP },
    ]);
    const sub = sheet("Videos/metadata.xlsx", "Videos", [
      {
        "@id": "./",
        "@type": ["Dataset", "RepositoryCollection"],
        identifier: SUB_ARCP,
        isPartOf: { "@id": MASTER_ARCP },
      },
      {
        "@id": "#obj1",
        "@type": "RepositoryObject",
        hasPart: { "@id": "clip.mov" },
      },
      { "@id": "clip.mov", "@type": "File", isPartOf: { "@id": "#obj1" } },
    ]);

    const result = mergeCrates([master, sub]);

    expect(byId(result, "Videos/clip.mov")).toBeDefined();
    expect(byId(result, "#obj1")?.["hasPart"]).toEqual({ "@id": "Videos/clip.mov" });
  });

  it("emits exactly one descriptor and orders the graph deterministically", () => {
    const master = sheet("root.xlsx", "", [
      { "@id": "./", "@type": ["Dataset", "RepositoryCollection"], identifier: MASTER_ARCP },
      { "@id": "#zeta", "@type": "Person" },
      { "@id": "#alpha", "@type": "Person" },
    ]);
    const sub = sheet("Sub/metadata.xlsx", "Sub", [
      {
        "@id": "./",
        "@type": ["Dataset", "RepositoryCollection"],
        identifier: SUB_ARCP,
        isPartOf: { "@id": MASTER_ARCP },
      },
    ]);

    const result = mergeCrates([master, sub]);
    const graph = graphOf(result);

    const descriptors = graph.filter((e) => e["@id"] === "ro-crate-metadata.json");
    expect(descriptors).toHaveLength(1);
    expect(graph[0]["@id"]).toBe("ro-crate-metadata.json");
    expect(graph[1]["@id"]).toBe("./");
    const rest = graph.slice(2).map((e) => e["@id"]);
    expect(rest).toEqual([...rest].sort((a, b) => String(a).localeCompare(String(b))));
  });

  it("warns when no single master collection can be identified", () => {
    const a = sheet("a.xlsx", "", [
      { "@id": "./", "@type": ["Dataset", "RepositoryCollection"], identifier: MASTER_ARCP },
    ]);
    const b = sheet("b.xlsx", "", [
      { "@id": "./", "@type": ["Dataset", "RepositoryCollection"], identifier: SUB_ARCP },
    ]);

    const result = mergeCrates([a, b]);
    expect(
      result.warnings.some(
        (w) => w.source === "merge" && /master/i.test(w.message),
      ),
    ).toBe(true);
  });

  it("detects an arcp identifier that was split on its internal comma", () => {
    const master = sheet("root.xlsx", "", [
      {
        "@id": "./",
        "@type": ["Dataset", "RepositoryCollection"],
        identifier: MASTER_ARCP,
        related: { "@id": "arcp://uuid" },
      },
    ]);

    const result = mergeCrates([master]);
    expect(
      result.warnings.some(
        (w) => w.source === "merge" && /split/i.test(w.message),
      ),
    ).toBe(true);
  });

  it("drops per-sheet unresolved-reference warnings that resolve after merge", () => {
    const master = sheet("root.xlsx", "", [
      {
        "@id": "./",
        "@type": ["Dataset", "RepositoryCollection"],
        identifier: MASTER_ARCP,
        creator: { "@id": "#person1" },
      },
    ]);
    master.warnings = [
      {
        source: "check",
        level: "warning",
        message: "Reference to #person1 is not defined",
        reference: "#person1",
      },
    ];
    const people = sheet("People/metadata.xlsx", "People", [
      {
        "@id": "./",
        "@type": ["Dataset", "RepositoryCollection"],
        identifier: SUB_ARCP,
        isPartOf: { "@id": MASTER_ARCP },
      },
      { "@id": "#person1", "@type": "Person", name: "Ada" },
    ]);

    const result = mergeCrates([master, people]);
    // The cross-sheet reference resolves, so no check warning should remain.
    expect(result.warnings.some((w) => w.source === "check")).toBe(false);
  });

  it("unions @context term definitions contributed by different sheets", () => {
    const master = sheet("root.xlsx", "", [
      { "@id": "./", "@type": ["Dataset", "RepositoryCollection"], identifier: MASTER_ARCP },
    ]);
    (master.crate as { "@context": unknown })["@context"] = [
      "https://w3id.org/ro/crate/1.2/context",
      { custom: "arcp://name,custom/terms#", "@vocab": "http://schema.org/" },
    ];
    const sub = sheet("Sub/metadata.xlsx", "Sub", [
      {
        "@id": "./",
        "@type": ["Dataset", "RepositoryCollection"],
        identifier: SUB_ARCP,
        isPartOf: { "@id": MASTER_ARCP },
      },
    ]);
    (sub.crate as { "@context": unknown })["@context"] = [
      "https://w3id.org/ro/crate/1.2/context",
      { ldac: "https://w3id.org/ldac/terms#", "@vocab": "http://schema.org/" },
    ];

    const result = mergeCrates([master, sub]);

    const context = (result.crate as { "@context": unknown[] })["@context"];
    const terms = context.find((e) => typeof e === "object") as Record<string, unknown>;
    expect(terms["custom"]).toBe("arcp://name,custom/terms#");
    expect(terms["ldac"]).toBe("https://w3id.org/ldac/terms#");
    // The shared base context string is deduped, not repeated.
    expect(context.filter((e) => typeof e === "string")).toEqual([
      "https://w3id.org/ro/crate/1.2/context",
    ]);
    expect(result.warnings.some((w) => w.source === "merge")).toBe(false);
  });

  it("keeps the master's value and warns once when a @context term conflicts", () => {
    const master = sheet("root.xlsx", "", [
      { "@id": "./", "@type": ["Dataset", "RepositoryCollection"], identifier: MASTER_ARCP },
    ]);
    (master.crate as { "@context": unknown })["@context"] = [
      "https://w3id.org/ro/crate/1.2/context",
      { custom: "arcp://name,custom/terms#" },
    ];
    const sub = sheet("Sub/metadata.xlsx", "Sub", [
      {
        "@id": "./",
        "@type": ["Dataset", "RepositoryCollection"],
        identifier: SUB_ARCP,
        isPartOf: { "@id": MASTER_ARCP },
      },
    ]);
    (sub.crate as { "@context": unknown })["@context"] = [
      "https://w3id.org/ro/crate/1.2/context",
      { custom: "arcp://name,other/terms#" },
    ];

    const result = mergeCrates([master, sub]);

    const context = (result.crate as { "@context": unknown[] })["@context"];
    const terms = context.find((e) => typeof e === "object") as Record<string, unknown>;
    expect(terms["custom"]).toBe("arcp://name,custom/terms#");
    const conflicts = result.warnings.filter(
      (w) => w.source === "merge" && w.reference === "custom",
    );
    expect(conflicts).toHaveLength(1);
  });
});
