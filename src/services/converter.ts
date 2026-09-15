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
  const booleanWarnings = coerceKnownBooleans(crate);
  return {
    crate,
    warnings: [
      ...repairWarnings,
      ...booleanWarnings,
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

// Boolean-flag columns (isPublishable, hasConsent, ...) arrive from Excel as the
// text "TRUE"/"FALSE", which is a truthy string. Coerce them to real booleans so
// consumers gating on the value behave correctly.
const BOOLEAN_KEY = /^(is|has|can)[A-Z]/;
const BOOLEAN_VALUE = /^(true|false)$/i;

function coerceKnownBooleans(crate: unknown): ConversionWarning[] {
  const graph = (crate as { "@graph"?: Array<Record<string, unknown>> })[
    "@graph"
  ];
  if (!Array.isArray(graph)) return [];
  const warnings: ConversionWarning[] = [];
  for (const entity of graph) {
    const id = typeof entity["@id"] === "string" ? entity["@id"] : "(unknown)";
    for (const [key, value] of Object.entries(entity)) {
      if (!BOOLEAN_KEY.test(key) || typeof value !== "string") continue;
      if (!BOOLEAN_VALUE.test(value)) continue;
      const coerced = value.toLowerCase() === "true";
      entity[key] = coerced;
      warnings.push({
        source: "repair",
        level: "warning",
        message: `Boolean stored as text in "${id}": ${key} "${value}" \u2192 ${coerced}`,
        repair: "boolean-as-text",
        before: value,
        after: String(coerced),
      });
    }
  }
  return warnings;
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
