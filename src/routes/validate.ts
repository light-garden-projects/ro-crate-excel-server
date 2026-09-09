import type { FastifyInstance } from "fastify";
import { validateCrate } from "../services/validator";

export async function validateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/validate", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== "object") {
      return reply.code(400).send({
        error:
          "Request body must be RO-Crate JSON-LD (application/json or application/ld+json).",
      });
    }

    const report = await validateCrate(body);
    return reply.send(report);
  });
}
