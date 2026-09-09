import { resolve } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type Config } from "./config";
import { convertRoutes } from "./routes/convert";
import { healthRoutes } from "./routes/health";

export async function buildApp(
  config: Config = loadConfig(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(fastifyMultipart, {
    limits: { fileSize: config.maxFileSize, files: 1 },
  });

  // Resolves to <project>/public from both src (tsx) and dist (compiled).
  await app.register(fastifyStatic, {
    root: resolve(__dirname, "../public"),
    index: "index.html",
  });

  await app.register(healthRoutes);
  await app.register(convertRoutes);

  return app;
}
