// Minimal ambient types for the untyped CommonJS `ro-crate-excel` library.
declare module "ro-crate-excel" {
  export class Workbook {
    constructor(options?: { crate?: unknown });
    crate: { getJson(): unknown };
    workbook: { xlsx: { writeFile(path: string): Promise<void> } };
    log: { info: string[]; warning: string[]; errors: string[] };
    loadExcel(filePath: string, add?: boolean): Promise<void>;
    loadExcelFromBuffer(buffer: Buffer, add?: boolean): Promise<void>;
    crateToWorkbook(): Promise<void>;
  }
}
