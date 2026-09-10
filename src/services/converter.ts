import { Workbook } from "ro-crate-excel";
import { repairWorkbookBuffer } from "./repairs";

// Raised when the uploaded workbook cannot be parsed into a crate.
export class ConversionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConversionError";
  }
}

export interface ConversionWarning {
  source: "ro-crate-excel" | "repair";
  level: "warning" | "error";
  message: string;
  repair?: string;
  cell?: string;
  before?: string;
  after?: string;
}

export interface ConversionResult {
  crate: unknown;
  warnings: ConversionWarning[];
}

export async function excelToCrateJson(
  fileBuffer: Buffer,
): Promise<ConversionResult> {
  const workbook = new Workbook();
  let repairWarnings: ConversionWarning[];
  try {
    const repaired = await repairWorkbookBuffer(fileBuffer);
    repairWarnings = repaired.warnings;
    await workbook.loadExcelFromBuffer(repaired.buffer);
  } catch (cause) {
    throw new ConversionError("Failed to parse the uploaded Excel file", {
      cause,
    });
  }
  return {
    crate: workbook.crate.getJson(),
    warnings: [...repairWarnings, ...collectWarnings(workbook.log)],
  };
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

