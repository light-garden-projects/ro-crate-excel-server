import { resolve } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type Config } from "./config";
import { convertRoutes } from "./routes/convert";
import { healthRoutes } from "./routes/health";
import { validateRoutes } from "./routes/validate";

export async function buildApp(
  config: Config = loadConfig(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Parse RO-Crate bodies posted with the JSON-LD media type as JSON.
  app.addContentTypeParser(
    "application/ld+json",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (error) {
        (error as { statusCode?: number }).statusCode = 400;
        done(error as Error, undefined);
      }
    },
  );

  await app.register(fastifyMultipart, {
    // preservePath keeps the directory portion of each part's filename so a
    // workbook can carry its archive-root-relative path (busboy basenames it otherwise).
    preservePath: true,
    limits: { fileSize: config.maxFileSize, files: config.maxFiles },
  });

  // Resolves to <project>/public from both src (tsx) and dist (compiled).
  await app.register(fastifyStatic, {
    root: resolve(__dirname, "../public"),
    index: "index.html",
  });

  await app.register(healthRoutes);
  await app.register(convertRoutes);
  await app.register(validateRoutes);

  return app;
}
