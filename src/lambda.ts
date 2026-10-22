import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import {
  eventPayload,
  type Enrollment,
  type EnrollmentStore,
  type Publisher,
  type Consumer,
} from "./domain.js";
import { makeHandlers } from "./handlers.js";
const table = process.env.TABLE_NAME,
  bus = process.env.EVENT_BUS_NAME;
if (!table || !bus)
  throw new Error("TABLE_NAME and EVENT_BUS_NAME are required.");
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 })),
  events = new EventBridgeClient({ maxAttempts: 3 });
const store: EnrollmentStore = {
  async commit(record: Enrollment) {
    try {
      await db.send(
        new PutCommand({
          TableName: table,
          Item: {
            pk: "ENROLLMENT#" + record.id,
            kind: "enrollment",
            payload: JSON.stringify(record),
          },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return { record, created: true };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== "ConditionalCheckFailedException"
      )
        throw error;
      const result = await db.send(
        new GetCommand({
          TableName: table,
          Key: { pk: "ENROLLMENT#" + record.id },
          ConsistentRead: true,
        }),
      );
      return {
        record: eventPayload(JSON.parse(String(result.Item?.payload))),
        created: false,
      };
    }
  },
};
const publisher: Publisher = {
  async publish(record) {
    const result = await events.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: bus,
            Source: "rehan.educore",
            DetailType: "EnrollmentRecorded",
            Detail: JSON.stringify(record),
          },
        ],
      }),
    );
    if (result.FailedEntryCount) throw new Error("Event publication failed.");
  },
};
const consumer: Consumer = {
  async consume(record) {
    // The durable mailbox row IS the business effect and idempotency record.
    try {
      await db.send(
        new PutCommand({
          TableName: table,
          Item: {
            pk: "NOTIFICATION#" + record.id,
            kind: "notification",
            payload: JSON.stringify(record),
          },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== "ConditionalCheckFailedException"
      )
        throw error;
    }
  },
};
const handlers = makeHandlers(store, publisher, consumer);
export const api = handlers.api;
export const stream = handlers.stream;
export const notify = handlers.notify;
