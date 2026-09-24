import type { FastifyInstance } from "fastify";
import { ConversionError, excelToCrateJson } from "../services/converter";

const XLSX_EXTENSION = ".xlsx";

interface UploadedSheet {
  /** Archive-root-relative POSIX path of this metadata sheet (e.g. "Collection A/metadata.xlsx"). */
  relativePath: string;
  /** POSIX dirname of relativePath ("" for a root-level sheet), captured for the upcoming merge step. */
  folderPrefix: string;
  buffer: Buffer;
}

export type SheetPathResult =
  | { ok: true; relativePath: string; folderPrefix: string }
  | { ok: false; status: number; error: string };

/**
 * Each uploaded workbook carries its archive-root-relative path as the multipart
 * part filename. This normalises that path and derives the folder prefix the merge
 * step will later prepend to the sheet's File @ids and hasPart targets.
 *
 * Rejects path-traversal, absolute paths, and non-.xlsx names (OWASP: path traversal).
 */
export function resolveSheetPath(rawFilename: string): SheetPathResult {
  const normalized = rawFilename.replace(/\\/g, "/").trim();
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      error:
        "Each file part must include a filename giving its path relative to the archive root.",
    };
  }
  if (!normalized.toLowerCase().endsWith(XLSX_EXTENSION)) {
    return {
      ok: false,
      status: 400,
      error: "Unsupported file type. Only .xlsx files are accepted.",
    };
  }
  if (normalized.startsWith("/")) {
    return {
      ok: false,
      status: 400,
      error: `File path must be relative to the archive root, not absolute: "${rawFilename}".`,
    };
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return {
      ok: false,
      status: 400,
      error: `File path must not contain empty, "." or ".." segments: "${rawFilename}".`,
    };
  }
  return {
    ok: true,
    relativePath: segments.join("/"),
    folderPrefix: segments.slice(0, -1).join("/"),
  };
}

export async function convertRoutes(app: FastifyInstance): Promise<void> {
  app.post("/convert", async (request, reply) => {
    const sheets: UploadedSheet[] = [];
    const seenPaths = new Set<string>();

    try {
      for await (const part of request.files()) {
        const resolved = resolveSheetPath(part.filename ?? "");
        if (!resolved.ok) {
          // Drain the current part so the multipart parser can clean up.
          await part.toBuffer();
          return reply.code(resolved.status).send({ error: resolved.error });
        }

        const buffer = await part.toBuffer();
        if (part.file.truncated) {
          return reply
            .code(413)
            .send({ error: "File exceeds the maximum allowed size." });
        }

        if (seenPaths.has(resolved.relativePath)) {
          return reply.code(400).send({
            error: `Duplicate file path: "${resolved.relativePath}". Each metadata sheet must have a unique path.`,
          });
        }
        seenPaths.add(resolved.relativePath);

        sheets.push({
          relativePath: resolved.relativePath,
          folderPrefix: resolved.folderPrefix,
          buffer,
        });
      }
    } catch (error) {
      // @fastify/multipart raises a limit error when too many files are sent.
      const code = (error as { code?: string }).code ?? "";
      if (code.includes("LIMIT")) {
        return reply
          .code(413)
          .send({ error: "Too many files or a file exceeds the size limit." });
      }
      throw error;
    }

    if (sheets.length === 0) {
      return reply.code(400).send({
        error:
          "No file uploaded. Send one or more .xlsx files in the 'file' field, each part's filename set to its path relative to the archive root.",
      });
    }

    const report = (request.query as { report?: string }).report;

    try {
      // A single sheet keeps the original response contract (bare crate, or a
      // { crate, warnings } envelope with ?report=1).
      if (sheets.length === 1) {
        const { crate, warnings } = await excelToCrateJson(sheets[0].buffer);
        if (report) {
          return reply.send({ crate, warnings });
        }
        return reply.type("application/ld+json").send(crate);
      }

      // Multiple sheets: interim per-sheet envelope until the merge step lands.
      const results = [];
      for (const sheet of sheets) {
        const { crate, warnings } = await excelToCrateJson(sheet.buffer);
        results.push({ path: sheet.relativePath, crate, warnings });
      }
      return reply.send({ sheets: results });
    } catch (error) {
      if (error instanceof ConversionError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });
}
