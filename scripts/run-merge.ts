import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { excelToCrateJson } from "../src/services/converter";
import { mergeCrates, type SheetCrate } from "../src/services/merge";
import { validate } from "ro-crate";

const DIR = join(__dirname, "..", "test-data", "multi-upload");
const OUT = join(DIR, "merged");
const OUT_FILE = join(OUT, "ro-crate-metadata.json");

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".xlsx")).sort();

  const sheets: SheetCrate[] = [];
  for (const file of files) {
    const buf = await readFile(join(DIR, file));
    const { crate, warnings } = await excelToCrateJson(buf);
    // Flat upload: the filename is the archive-relative path; no folder prefix.
    sheets.push({ relativePath: file, folderPrefix: "", crate, warnings });
  }

  const { crate, warnings } = mergeCrates(sheets);
  await writeFile(OUT_FILE, JSON.stringify(crate, null, 2));

  const graph = (crate as { "@graph": Array<Record<string, unknown>> })["@graph"];
  console.log(`Merged ${files.length} sheets -> ${OUT_FILE}`);
  console.log(`  entities: ${graph.length}`);
  console.log(`  merge warnings: ${warnings.length}`);
  for (const w of warnings) console.log(`    - [${w.source}/${w.level}] ${w.message}`);

  const results = (await validate(crate)) as Array<{ status: string; message: string }>;
  const errors = results.filter((r) => r.status === "error");
  const warns = results.filter((r) => r.status === "warning");
  console.log(`\n  ro-crate validate(): ${errors.length} error(s), ${warns.length} warning(s)`);
  for (const r of [...errors, ...warns]) console.log(`    - [${r.status}] ${r.message}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
