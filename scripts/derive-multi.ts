import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { excelToCrateJson } from "../src/services/converter";
import { findUnresolvedReferences } from "../src/services/checks";

const DIR = join(__dirname, "..", "test-data", "multi-upload");
const OUT = join(DIR, "derived");

type Entity = Record<string, unknown> & { "@id"?: string; "@type"?: unknown };

function typeOf(e: Entity): string {
  const t = e["@type"];
  return Array.isArray(t) ? t.join(",") : String(t ?? "");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".xlsx")).sort();
  const allGraphs: Entity[][] = [];
  for (const file of files) {
    const buf = await readFile(join(DIR, file));
    let result;
    try {
      result = await excelToCrateJson(buf);
    } catch (err) {
      console.log(`\n### ${file}\n  ERROR: ${(err as Error).message}`);
      continue;
    }
    const graph = (result.crate as { "@graph"?: Entity[] })["@graph"] ?? [];
    allGraphs.push(graph);
    const root = graph.find((e) => e["@id"] === "./");
    await writeFile(
      join(OUT, file.replace(/\.xlsx$/, ".json")),
      JSON.stringify(result.crate, null, 2),
    );
    console.log(`\n### ${file}`);
    console.log(`  entities: ${graph.length}`);
    console.log(
      `  root ./ : type=[${root ? typeOf(root) : "MISSING"}] name=${JSON.stringify(root?.name)} identifier=${JSON.stringify(root?.identifier)}`,
    );
    if (root && "isPartOf" in root) {
      console.log(`  root isPartOf: ${JSON.stringify(root.isPartOf)}`);
    }
    const types = new Map<string, number>();
    for (const e of graph) {
      const t = typeOf(e);
      types.set(t, (types.get(t) ?? 0) + 1);
    }
    console.log(
      `  types: ${[...types.entries()].map(([t, n]) => `${t}×${n}`).join(", ")}`,
    );
    console.log(`  warnings: ${result.warnings.length}`);
    for (const w of result.warnings) {
      console.log(`    - [${w.source}/${w.level}] ${w.message}`);
    }
  }

  // Naive union-merge probe: concatenate all graphs, dedupe by @id (last wins).
  // Then re-run the unresolved-reference check on the combined graph.
  const byId = new Map<string, Entity>();
  for (const graph of allGraphs) {
    for (const e of graph) {
      const id = e["@id"];
      if (typeof id !== "string") continue;
      byId.set(id, e);
    }
  }
  const merged = { "@graph": [...byId.values()] };
  console.log(`\n\n=== UNION-MERGE PROBE (naive, dedupe by @id) ===`);
  console.log(`  total distinct entities: ${byId.size}`);
  const unresolved = findUnresolvedReferences(merged);
  console.log(`  residual unresolved references: ${unresolved.length}`);
  for (const w of unresolved) {
    console.log(`    - ${w.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
