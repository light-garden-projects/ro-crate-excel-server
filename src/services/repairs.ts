import ExcelJS from "exceljs";
import type { ConversionWarning } from "./converter";

export interface Repair {
  id: string;
  title: string;
  description: string;
  detect(value: string): boolean;
  fix(value: string): string;
}

const REFERENCE_TOKEN = /^#\S+$/;

// Each entry both drives the repair pass and documents itself on /repairs.
export const repairs: Repair[] = [
  {
    id: "reference-list-unbracketed",
    title: "Unbracketed reference list",
    description:
      'A cell listing several #-references separated by commas but without the surrounding [ ] that ro-crate-excel needs to split them. Left as-is it becomes a single broken @id like "#a, #b". We wrap the value in [ ] so each reference stays separate.',
    detect(value) {
      const trimmed = value.trim();
      if (trimmed.startsWith("[")) return false;
      const tokens = trimmed.split(/\s*,\s*/);
      return tokens.length >= 2 && tokens.every((t) => REFERENCE_TOKEN.test(t));
    },
    fix(value) {
      const tokens = value.trim().split(/\s*,\s*/);
      return `[${tokens.join(", ")}]`;
    },
  },
];

// Applies the repair registry to every string cell, before ro-crate-excel sees the file.
export async function repairWorkbookBuffer(
  buffer: Buffer,
): Promise<{ buffer: Buffer; warnings: ConversionWarning[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const warnings: ConversionWarning[] = [];

  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value !== "string") return;
        const before = cell.value;
        for (const repair of repairs) {
          if (!repair.detect(before)) continue;
          const after = repair.fix(before);
          cell.value = after;
          const location = `${sheet.name}!${cell.address}`;
          warnings.push({
            source: "repair",
            level: "warning",
            message: `${repair.title} in ${location}: "${before}" \u2192 "${after}"`,
            repair: repair.id,
            cell: location,
            before,
            after,
          });
          break;
        }
      });
    });
  }

  if (warnings.length === 0) {
    return { buffer, warnings };
  }
  const repaired = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(repaired), warnings };
}
