import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

const validCrate = {
  "@context": "https://w3id.org/ro/crate/1.2/context",
  "@graph": [
    {
      "@id": "ro-crate-metadata.json",
      "@type": "CreativeWork",
      about: { "@id": "./" },
      conformsTo: { "@id": "https://w3id.org/ro/crate/1.2" },
    },
    {
      "@id": "./",
      "@type": "Dataset",
      name: "Test Crate",
      description: "A minimal crate for validation tests.",
      datePublished: "2024-01-01",
      license: { "@id": "https://creativecommons.org/licenses/by/4.0/" },
    },
  ],
};

// Missing @graph is a deterministic, offline validation error.
const invalidCrate = {
  "@context": "https://w3id.org/ro/crate/1.2/context",
  foo: "bar",
};

describe("POST /validate", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts application/ld+json and reports a valid crate", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/validate",
      headers: { "content-type": "application/ld+json" },
      payload: JSON.stringify(validCrate),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(true);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("accepts application/json and flags an invalid crate", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/validate",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(invalidCrate),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(false);
    expect(
      body.results.some(
        (result: { status: string }) => result.status === "error",
      ),
    ).toBe(true);
  });

  it("rejects a non-object body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/validate",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify("hello"),
    });

    expect(response.statusCode).toBe(400);
  });
});
