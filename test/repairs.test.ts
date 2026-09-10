import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { excelToCrateJson } from "../src/services/converter";
import { repairWorkbookBuffer, repairs } from "../src/services/repairs";

const referenceListRepair = repairs.find(
  (r) => r.id === "reference-list-unbracketed",
);

if (!referenceListRepair) {
  throw new Error("reference-list-unbracketed repair is missing");
}

describe("reference-list-unbracketed detection", () => {
  it.each([
    ["#a, #b", true],
    ["#a,#b,#c", true],
    ["#Person_1, #Person_2", true],
    ["#a", false],
    ["Museum, Darwin", false],
    ["#a, plain text", false],
    ["[#a, #b]", false],
    ["", false],
  ])("detect(%j) === %s", (value, expected) => {
    expect(referenceListRepair.detect(value)).toBe(expected);
  });

  it("wraps a matched value in brackets", () => {
    expect(referenceListRepair.fix("#a, #b")).toBe("[#a, #b]");
    expect(referenceListRepair.fix("#a,#b,#c")).toBe("[#a, #b, #c]");
  });
});

describe("repairWorkbookBuffer", () => {
  async function bufferWithCell(value: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");
    sheet.getCell("A1").value = value;
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  it("brackets an unbracketed reference list and reports it", async () => {
    const input = await bufferWithCell("#a, #b");
    const { buffer, warnings } = await repairWorkbookBuffer(input);

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer);
    expect(reloaded.getWorksheet("Data")?.getCell("A1").value).toBe("[#a, #b]");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      source: "repair",
      level: "warning",
      repair: "reference-list-unbracketed",
      cell: "Data!A1",
      before: "#a, #b",
      after: "[#a, #b]",
    });
  });

  it("leaves an unaffected workbook untouched with no warnings", async () => {
    const input = await bufferWithCell("just a description");
    const { buffer, warnings } = await repairWorkbookBuffer(input);
    expect(warnings).toHaveLength(0);
    expect(buffer).toBe(input);
  });
});

describe("excelToCrateJson repair integration", () => {
  async function buildBuggyWorkbook(): Promise<Buffer> {
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

    const people = workbook.addWorksheet("@type=Person");
    people.addRow(["@id", "@type", "name"]);
    people.addRow(["#p1", "Person", "Alice"]);
    people.addRow(["#p2", "Person", "Bob"]);

    const things = workbook.addWorksheet("@type=Dataset");
    things.addRow(["@id", "@type", "name", "isRef_contributor"]);
    things.addRow(["#thing", "Dataset", "MyThing", "#p1, #p2"]);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  it("splits an unbracketed isRef reference list into separate references", async () => {
    const { crate, warnings } = (await excelToCrateJson(
      await buildBuggyWorkbook(),
    )) as {
      crate: { "@graph": Array<Record<string, unknown>> };
      warnings: Array<Record<string, unknown>>;
    };

    const thing = crate["@graph"].find((item) => item["@id"] === "#thing");
    expect(thing?.contributor).toEqual([{ "@id": "#p1" }, { "@id": "#p2" }]);

    expect(
      warnings.some((w) => w.repair === "reference-list-unbracketed"),
    ).toBe(true);
  });
});
