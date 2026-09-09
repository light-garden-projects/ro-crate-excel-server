// Augments the untyped `validate` export missing from ro-crate's shipped types.
declare module "ro-crate" {
  export interface CrateValidationResult {
    id: string;
    status: "success" | "warning" | "error";
    message: string;
    clause?: string | null;
  }
  export function validate(
    crate: unknown,
    files?: unknown,
  ): Promise<CrateValidationResult[]>;
}
