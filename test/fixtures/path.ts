import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "sample.xlsx",
);
