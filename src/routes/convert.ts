import type { FastifyInstance } from "fastify";
import { ConversionError, excelToCrateJson } from "../services/converter";

const XLSX_EXTENSION = ".xlsx";

export async function convertRoutes(app: FastifyInstance): Promise<void> {
  app.post("/convert", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply
        .code(400)
        .send({
          error: "No file uploaded. Send an .xlsx file in the 'file' field.",
        });
    }

    if (!file.filename.toLowerCase().endsWith(XLSX_EXTENSION)) {
      return reply
        .code(400)
        .send({
          error: "Unsupported file type. Only .xlsx files are accepted.",
        });
    }

    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      return reply
        .code(413)
        .send({ error: "File exceeds the maximum allowed size." });
    }

    try {
      const crate = await excelToCrateJson(buffer);
      return reply.type("application/ld+json").send(crate);
    } catch (error) {
      if (error instanceof ConversionError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });
}
