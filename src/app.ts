import fastifyMultipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type Config } from "./config";
import { convertRoutes } from "./routes/convert";
import { healthRoutes } from "./routes/health";

export async function buildApp(config: Config = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(fastifyMultipart, {
    limits: { fileSize: config.maxFileSize, files: 1 },
  });

  await app.register(healthRoutes);
  await app.register(convertRoutes);

  return app;
}
