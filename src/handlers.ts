import {
  enrollment,
  eventPayload,
  ValidationError,
  type EnrollmentStore,
  type Publisher,
  type Consumer,
} from "./domain.js";
interface StreamRecord {
  eventName?: string;
  eventID?: string;
  dynamodb?: {
    SequenceNumber?: string;
    NewImage?: { payload?: { S?: string }; kind?: { S?: string } };
  };
}
export function makeHandlers(
  store: EnrollmentStore,
  publisher: Publisher,
  consumer: Consumer,
) {
  return {
    async api(event: { body?: string | null; isBase64Encoded?: boolean }) {
      const reply = (statusCode: number, data: unknown) => ({
        statusCode,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
        body: JSON.stringify(data),
      });
      if (!event.body)
        return reply(400, { error: "A JSON enrolment is required." });
      if (event.body.length > 8192)
        return reply(413, { error: "Request too large." });
      try {
        const raw = event.isBase64Encoded
          ? Buffer.from(event.body, "base64").toString("utf8")
          : event.body;
        if (Buffer.byteLength(raw) > 4096)
          return reply(413, { error: "Request too large." });
        let input: unknown;
        try {
          input = JSON.parse(raw);
        } catch {
          return reply(400, { error: "Invalid JSON." });
        }
        const record = enrollment(input);
        const result = await store.commit(record);
        return reply(result.created ? 201 : 200, result.record);
      } catch (error) {
        return error instanceof ValidationError
          ? reply(400, { error: error.message })
          : reply(503, { error: "Enrolment is temporarily unavailable." });
      }
    },
    async stream(event: { Records?: StreamRecord[] }) {
      const batchItemFailures: { itemIdentifier: string }[] = [];
      for (const record of event.Records || []) {
        if (
          record.eventName !== "INSERT" ||
          record.dynamodb?.NewImage?.kind?.S !== "enrollment"
        )
          continue;
        const identifier = record.dynamodb.SequenceNumber;
        if (!identifier) throw new Error("Stream sequence number missing.");
        try {
          const payload = eventPayload(
            JSON.parse(record.dynamodb.NewImage.payload?.S || "null"),
          );
          await publisher.publish(payload);
        } catch {
          batchItemFailures.push({ itemIdentifier: identifier });
        }
      }
      return { batchItemFailures };
    },
    async notify(event: { detail: unknown }) {
      await consumer.consume(eventPayload(event.detail));
    },
  };
}
