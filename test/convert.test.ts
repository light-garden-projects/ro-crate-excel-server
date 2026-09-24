import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import FormData from "form-data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { resolveSheetPath } from "../src/routes/convert";
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

  it("converts multiple workbooks into a per-sheet envelope", async () => {
    const form = new FormData();
    form.append("file", fixture, {
      filepath: "ro-crate-metadata.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    form.append("file", fixture, {
      filepath: "Collection A/Videos/metadata.xlsx",
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
    expect(Array.isArray(body.sheets)).toBe(true);
    expect(body.sheets).toHaveLength(2);
    expect(body.sheets.map((s: { path: string }) => s.path)).toEqual([
      "ro-crate-metadata.xlsx",
      "Collection A/Videos/metadata.xlsx",
    ]);
    for (const sheet of body.sheets) {
      expect(sheet.crate).toHaveProperty("@graph");
      expect(Array.isArray(sheet.warnings)).toBe(true);
    }
  });

  it("rejects a path with a traversal segment", async () => {
    const form = new FormData();
    form.append("file", fixture, {
      filepath: "../escape.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const response = await app.inject({
      method: "POST",
      url: "/convert",
      payload: form,
      headers: form.getHeaders(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("segments");
  });

  it("rejects an absolute path", async () => {
    const form = new FormData();
    form.append("file", fixture, {
      filepath: "/etc/metadata.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const response = await app.inject({
      method: "POST",
      url: "/convert",
      payload: form,
      headers: form.getHeaders(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("absolute");
  });

  it("rejects duplicate paths across the upload", async () => {
    const form = new FormData();
    form.append("file", fixture, {
      filepath: "Collection A/metadata.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    form.append("file", fixture, {
      filepath: "Collection A/metadata.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const response = await app.inject({
      method: "POST",
      url: "/convert",
      payload: form,
      headers: form.getHeaders(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Duplicate");
  });
});

describe("resolveSheetPath", () => {
  it("normalises backslashes and derives the folder prefix", () => {
    const result = resolveSheetPath("Collection A\\Videos\\metadata.xlsx");
    expect(result).toEqual({
      ok: true,
      relativePath: "Collection A/Videos/metadata.xlsx",
      folderPrefix: "Collection A/Videos",
    });
  });

  it("derives an empty prefix for a root-level sheet", () => {
    const result = resolveSheetPath("ro-crate-metadata.xlsx");
    expect(result).toEqual({
      ok: true,
      relativePath: "ro-crate-metadata.xlsx",
      folderPrefix: "",
    });
  });

  it("rejects traversal, absolute, empty, and non-xlsx paths", () => {
    expect(resolveSheetPath("a/../b.xlsx").ok).toBe(false);
    expect(resolveSheetPath("/abs/b.xlsx").ok).toBe(false);
    expect(resolveSheetPath("a//b.xlsx").ok).toBe(false);
    expect(resolveSheetPath("   ").ok).toBe(false);
    expect(resolveSheetPath("notes.txt").ok).toBe(false);
  });
});
