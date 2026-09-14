import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { excelToCrateJson } from "../src/services/converter";

describe("leaked isRef_ cleanup", () => {
  async function buildWorkbookWithEmptyRootRef(): Promise<Buffer> {
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
    root.addRow(["isRef_license", ""]);
    root.addRow(["isRef_author", ""]);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  it("drops empty isRef_* properties while leaving real ones intact", async () => {
    const { crate } = (await excelToCrateJson(
      await buildWorkbookWithEmptyRootRef(),
    )) as { crate: { "@graph": Array<Record<string, unknown>> } };

    const root = crate["@graph"].find((item) => item["@id"] === "./");
    expect(root).toBeDefined();
    const keys = Object.keys(root as Record<string, unknown>);
    expect(keys.some((key) => key.startsWith("isRef_"))).toBe(false);
    expect(root?.name).toBe("Test");
  });
});
