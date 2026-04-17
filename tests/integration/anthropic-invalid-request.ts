// @ts-nocheck
import { WORKER_BASE_URL, assert } from "./_anthropic";

async function malformedJsonCase() {
  const response = await fetch(`${WORKER_BASE_URL}/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: "{",
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  assert(response.status === 400, `Expected 400, got ${response.status}`);
  assert(response.headers.get("x-trace-id"), "Missing x-trace-id header for malformed JSON");
  assert(
    json?.error?.type === "invalid_request",
    `Unexpected malformed JSON error type: ${JSON.stringify(json)}`,
  );
  assert(
    json?.error?.message === "Request body must be valid JSON",
    `Unexpected malformed JSON message: ${JSON.stringify(json)}`,
  );

  return {
    traceId: response.headers.get("x-trace-id"),
    error: json.error,
  };
}

async function schemaInvalidCase() {
  const response = await fetch(`${WORKER_BASE_URL}/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 128,
      messages: [{ role: "system", content: "bad role" }],
    }),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  assert(response.status === 400, `Expected 400, got ${response.status}`);
  assert(response.headers.get("x-trace-id"), "Missing x-trace-id header for schema-invalid JSON");
  assert(
    json?.error?.type === "invalid_request",
    `Unexpected schema-invalid error type: ${JSON.stringify(json)}`,
  );
  assert(
    json?.error?.message === "Invalid anthropic messages request",
    `Unexpected schema-invalid message: ${JSON.stringify(json)}`,
  );

  return {
    traceId: response.headers.get("x-trace-id"),
    error: json.error,
  };
}

async function main() {
  const malformed = await malformedJsonCase();
  const schemaInvalid = await schemaInvalidCase();

  console.log(
    JSON.stringify(
      {
        status: "ok",
        malformed,
        schemaInvalid,
      },
      null,
      2,
    ),
  );
}

await main();
