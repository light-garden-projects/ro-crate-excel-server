import { env } from "node:process";

export interface Config {
  host: string;
  port: number;
  maxFileSize: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;

export function loadConfig(): Config {
  return {
    host: env.HOST ?? DEFAULT_HOST,
    port: Number(env.PORT ?? DEFAULT_PORT),
    maxFileSize: Number(env.MAX_FILE_SIZE ?? DEFAULT_MAX_FILE_SIZE),
  };
}
