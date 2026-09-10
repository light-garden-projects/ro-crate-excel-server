import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workbook } from "ro-crate-excel";

// Raised when the uploaded workbook cannot be parsed into a crate.
export class ConversionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConversionError";
  }
}

export interface ConversionWarning {
  source: "ro-crate-excel";
  level: "warning" | "error";
  message: string;
}

export interface ConversionResult {
  crate: unknown;
  warnings: ConversionWarning[];
}

export async function excelToCrateJson(
  fileBuffer: Buffer,
): Promise<ConversionResult> {
  // ro-crate-excel reads from disk, so the upload is staged in a private temp dir.
  const workDir = await mkdtemp(join(tmpdir(), "rocxl-"));
  const xlsxPath = join(workDir, "ro-crate-metadata.xlsx");
  try {
    await writeFile(xlsxPath, fileBuffer);
    const workbook = new Workbook();
    try {
      await workbook.loadExcel(xlsxPath);
    } catch (cause) {
      throw new ConversionError("Failed to parse the uploaded Excel file", {
        cause,
      });
    }
    return {
      crate: workbook.crate.getJson(),
      warnings: collectWarnings(workbook.log),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function collectWarnings(log: {
  warning: string[];
  errors: string[];
}): ConversionWarning[] {
  return [
    ...log.warning.map(
      (message): ConversionWarning => ({
        source: "ro-crate-excel",
        level: "warning",
        message,
      }),
    ),
    ...log.errors.map(
      (message): ConversionWarning => ({
        source: "ro-crate-excel",
        level: "error",
        message,
      }),
    ),
  ];
}

