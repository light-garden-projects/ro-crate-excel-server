import { Workbook } from "ro-crate-excel";
import { repairWorkbookBuffer } from "./repairs";
import { findUnresolvedReferences } from "./checks";

// Raised when the uploaded workbook cannot be parsed into a crate.
export class ConversionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConversionError";
  }
}

export interface ConversionWarning {
  source: "ro-crate-excel" | "repair" | "check";
  level: "warning" | "error";
  message: string;
  repair?: string;
  cell?: string;
  before?: string;
  after?: string;
  reference?: string;
  count?: number;
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
  const crate = workbook.crate.getJson();
  stripLeakedRefPrefixes(crate);
  return {
    crate,
    warnings: [
      ...repairWarnings,
      ...collectWarnings(workbook.log),
      ...findUnresolvedReferences(crate),
    ],
  };
}

// ro-crate-excel leaves empty isRef_* columns as literal properties (its prefix
// stripping only fires when the cell has a value). Drop them so the output carries
// no bogus schema:isRef_* predicates.
function stripLeakedRefPrefixes(crate: unknown): void {
  const graph = (crate as { "@graph"?: Array<Record<string, unknown>> })[
    "@graph"
  ];
  if (!Array.isArray(graph)) return;
  for (const entity of graph) {
    for (const key of Object.keys(entity)) {
      if (key.startsWith("isRef_") && entity[key] === "") delete entity[key];
    }
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
