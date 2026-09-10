import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import FormData from "form-data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { generateFixture } from "./fixtures/generate";

describe("POST /convert", () => {
  let app: FastifyInstance;
  let fixture: Buffer;

  beforeAll(async () => {
    app = await buildApp();
    const fixturePath = await generateFixture();
    fixture = await readFile(fixturePath);
  });

  afterAll(async () => {
    await app.close();
  });

  it("converts an xlsx upload into RO-Crate JSON-LD", async () => {
    const form = new FormData();
    form.append("file", fixture, {
      filename: "sample.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const response = await app.inject({
      method: "POST",
      url: "/convert",
      payload: form,
      headers: form.getHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("@context");
    expect(body).toHaveProperty("@graph");
    expect(Array.isArray(body["@graph"])).toBe(true);
  });

  it("returns a { crate, warnings } envelope when report=1", async () => {
    const form = new FormData();
    form.append("file", fixture, {
      filename: "sample.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const response = await app.inject({
      method: "POST",
      url: "/convert?report=1",
      payload: form,
      headers: form.getHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.crate).toHaveProperty("@graph");
    expect(Array.isArray(body.warnings)).toBe(true);
    for (const warning of body.warnings) {
      expect(warning).toMatchObject({
        source: "ro-crate-excel",
        level: expect.stringMatching(/^(warning|error)$/),
        message: expect.any(String),
      });
    }
  });

  it("rejects a request with no file", async () => {
    const form = new FormData();
    form.append("notafile", "hello");

    const response = await app.inject({
      method: "POST",
      url: "/convert",
      payload: form,
      headers: form.getHeaders(),
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a non-xlsx file", async () => {
    const form = new FormData();
    form.append("file", Buffer.from("not a spreadsheet"), {
      filename: "notes.txt",
      contentType: "text/plain",
    });

    const response = await app.inject({
      method: "POST",
      url: "/convert",
      payload: form,
      headers: form.getHeaders(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Only .xlsx");
  });
});
