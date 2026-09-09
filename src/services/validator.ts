import { validate, type CrateValidationResult } from "ro-crate";

export interface ValidationReport {
  valid: boolean;
  results: CrateValidationResult[];
}

// Runs ro-crate's validator without a file list, so uploads aren't flagged for missing data files.
export async function validateCrate(
  crateJson: unknown,
): Promise<ValidationReport> {
  const results = await validate(crateJson);
  const valid = results.every((result) => result.status !== "error");
  return { valid, results };
}
