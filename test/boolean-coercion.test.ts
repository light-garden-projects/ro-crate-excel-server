import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { excelToCrateJson } from "../src/services/converter";

describe("boolean-as-text coercion", () => {
  async function buildWorkbook(): Promise<Buffer> {
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

    const objects = workbook.addWorksheet("@type=RepositoryObject");
    objects.addRow(["@id", "@type", "name", "isPublishable"]);
    objects.addRow(["#obj", "RepositoryObject", "TRUE", "FALSE"]);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  it("coerces a boolean-flag string to a real boolean and reports it", async () => {
    const { crate, warnings } = (await excelToCrateJson(
      await buildWorkbook(),
    )) as {
      crate: { "@graph": Array<Record<string, unknown>> };
      warnings: Array<Record<string, unknown>>;
    };

    const obj = crate["@graph"].find((item) => item["@id"] === "#obj");
    expect(obj?.isPublishable).toBe(false);
    // A non-flag field holding the word "TRUE" must be left as text.
    expect(obj?.name).toBe("TRUE");

    expect(
      warnings.some(
        (w) => w.repair === "boolean-as-text" && w.source === "repair",
      ),
    ).toBe(true);
  });
});
