import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ROCrate } from "ro-crate";
import { Workbook } from "ro-crate-excel";
import { FIXTURE_PATH } from "./path";

const crateJson = {
  "@context": "https://w3id.org/ro/crate/1.1/context",
  "@graph": [
    {
      "@id": "ro-crate-metadata.json",
      "@type": "CreativeWork",
      conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" },
      about: { "@id": "./" },
    },
    {
      "@id": "./",
      "@type": "Dataset",
      name: "Sample Dataset",
      description: "A small dataset used for tests.",
      datePublished: "2024-01-01",
    },
  ],
};

export async function generateFixture(): Promise<string> {
  await mkdir(dirname(FIXTURE_PATH), { recursive: true });
  const crate = new ROCrate(crateJson, { array: true, link: true });
  const workbook = new Workbook({ crate });
  await workbook.crateToWorkbook();
  await workbook.workbook.xlsx.writeFile(FIXTURE_PATH);
  return FIXTURE_PATH;
}
