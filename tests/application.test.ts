import { test } from "node:test";
import assert from "node:assert/strict";
test("the bundled Lambda entry point loads and validates without cloud access", async () => {
  process.env.TABLE_NAME = "isolated-test-table";
  process.env.EVENT_BUS_NAME = "isolated-test-bus";
  process.env.AWS_REGION = "us-east-1";
  const bundleUrl = new URL("../../dist-lambda/lambda.cjs", import.meta.url)
    .href;
  const bundle = await import(bundleUrl);
  const response = await bundle.api({ body: "{}" });
  assert.equal(response.statusCode, 400);
  assert.equal(typeof bundle.stream, "function");
  assert.equal(typeof bundle.notify, "function");
});
import { enrollment, ValidationError } from "../src/domain.js";
import { MemoryStore } from "../src/memory.js";
import { makeHandlers } from "../src/handlers.js";
import { createLocalServer } from "../src/local.js";
const input = {
  courseId: "11111111-1111-4111-8111-111111111111",
  studentId: "22222222-2222-4222-8222-222222222222",
};
test("identity is stable across retries and UUID casing", () => {
  assert.equal(
    enrollment(input).id,
    enrollment({ ...input, courseId: input.courseId.toUpperCase() }).id,
  );
  assert.throws(() => enrollment(null), ValidationError);
  assert.throws(
    () => enrollment({ ...input, studentId: "bad" }),
    ValidationError,
  );
});
test("atomic local commit creates one record and outbox event", async () => {
  const store = new MemoryStore(),
    record = enrollment(input);
  await Promise.all(Array.from({ length: 10 }, () => store.commit(record)));
  assert.equal(store.records.size, 1);
  assert.equal(store.outbox.length, 1);
  await store.drain();
  await store.consume(record);
  assert.equal(store.mailbox.size, 1);
  assert.equal(store.deliveries, 2);
});
test("stream retries only failed sequence numbers", async () => {
  const store = new MemoryStore();
  const handlers = makeHandlers(
    store,
    {
      publish: async () => {
        throw new Error("failure");
      },
    },
    store,
  );
  const result = await handlers.stream({
    Records: [
      {
        eventName: "INSERT",
        dynamodb: {
          SequenceNumber: "1",
          NewImage: {
            kind: { S: "enrollment" },
            payload: { S: JSON.stringify(enrollment(input)) },
          },
        },
      },
      { eventName: "MODIFY", dynamodb: { SequenceNumber: "2" } },
    ],
  });
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "1" }] });
});
test("API validates input and does not expose storage failures", async () => {
  const store = new MemoryStore(),
    handlers = makeHandlers(
      {
        commit: async () => {
          throw new Error("private-key");
        },
      },
      { publish: async () => {} },
      store,
    );
  assert.equal((await handlers.api({ body: "null" })).statusCode, 400);
  assert.equal((await handlers.api({ body: "{" })).statusCode, 400);
  assert.equal(
    (await handlers.api({ body: "x".repeat(9000) })).statusCode,
    413,
  );
  const result = await handlers.api({ body: JSON.stringify(input) });
  assert.equal(result.statusCode, 503);
  assert.ok(!result.body.includes("private-key"));
});
test("local HTTP flow delivers exactly one mailbox row for duplicate enrolments", async () => {
  const { server } = createLocalServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = "http://127.0.0.1:" + address.port;
  try {
    const request = () =>
      fetch(base + "/enrollments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    const first = await request();
    assert.equal(first.status, 201);
    const record = (await first.json()) as { id: string };
    assert.equal((await request()).status, 200);
    assert.deepEqual(
      await (await fetch(base + "/notifications/" + record.id)).json(),
      { effects: 1 },
    );
    assert.equal(
      (await fetch(base + "/enrollments", { method: "POST", body: "x" }))
        .status,
      415,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
