import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { findUnresolvedReferences } from "../src/services/checks";
import { excelToCrateJson } from "../src/services/converter";

describe("findUnresolvedReferences", () => {
  it("flags a reference with no defining entity", () => {
    const crate = {
      "@graph": [
        { "@id": "./", "@type": "Dataset", author: { "@id": "#missing" } },
      ],
    };
    const warnings = findUnresolvedReferences(crate);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      source: "check",
      level: "warning",
      reference: "#missing",
      count: 1,
    });
  });

  it("does not flag a reference that is defined in the graph", () => {
    const crate = {
      "@graph": [
        { "@id": "./", "@type": "Dataset", author: { "@id": "#p1" } },
        { "@id": "#p1", "@type": "Person", name: "Alice" },
      ],
    };
    expect(findUnresolvedReferences(crate)).toHaveLength(0);
  });

  it("ignores references that are absolute URIs", () => {
    const crate = {
      "@graph": [
        {
          "@id": "./",
          "@type": "Dataset",
          license: { "@id": "https://creativecommons.org/licenses/by/4.0/" },
          conformsTo: { "@id": "urn:example:profile" },
        },
      ],
    };
    expect(findUnresolvedReferences(crate)).toHaveLength(0);
  });

  it("reports each missing id once with a usage count", () => {
    const crate = {
      "@graph": [
        {
          "@id": "./",
          "@type": "Dataset",
          author: [{ "@id": "#missing" }, { "@id": "#missing" }],
          contributor: { "@id": "#missing" },
        },
      ],
    };
    const warnings = findUnresolvedReferences(crate);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ reference: "#missing", count: 3 });
  });

  it("sorts warnings by referenced id", () => {
    const crate = {
      "@graph": [
        {
          "@id": "./",
          "@type": "Dataset",
          hasPart: [{ "@id": "#b" }, { "@id": "#a" }],
        },
      ],
    };
    const warnings = findUnresolvedReferences(crate);
    expect(warnings.map((w) => w.reference)).toEqual(["#a", "#b"]);
  });

  it("does not treat inline nodes as references", () => {
    const crate = {
      "@graph": [
        {
          "@id": "./",
          "@type": "Dataset",
          author: { "@id": "#p1", name: "Alice" },
        },
      ],
    };
    expect(findUnresolvedReferences(crate)).toHaveLength(0);
  });

  it("returns nothing when there is no graph", () => {
    expect(findUnresolvedReferences({})).toHaveLength(0);
    expect(findUnresolvedReferences(null)).toHaveLength(0);
  });
});

describe("excelToCrateJson unresolved-reference integration", () => {
  async function buildWorkbookWithDanglingRef(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    const context = workbook.addWorksheet("@context");
    context.getCell("A1").value = "name";
    context.getCell("B1").value = "@id";

    const root = workbook.addWorksheet("RootDataset");
    root.addRow(["Name", "Value"]);
    root.addRow(["@id", "./"]);
    root.addRow(["@type", "Dataset"]);
    root.addRow(["name", "Test"]);
    root.addRow(["description", "A dataset for tests."]);
    root.addRow(["datePublished", "2024-01-01"]);

    const things = workbook.addWorksheet("@type=Dataset");
    things.addRow(["@id", "@type", "name", "isRef_contributor"]);
    things.addRow(["#thing", "Dataset", "MyThing", "#ghost"]);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  it("emits a check warning for an undefined referenced id", async () => {
    const { warnings } = (await excelToCrateJson(
      await buildWorkbookWithDanglingRef(),
    )) as { warnings: Array<Record<string, unknown>> };

    expect(
      warnings.some(
        (w) => w.source === "check" && w.reference === "#ghost",
      ),
    ).toBe(true);
  });
});
