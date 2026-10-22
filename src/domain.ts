import { createHash } from "node:crypto";
export class ValidationError extends Error {}
export interface Enrollment {
  id: string;
  courseId: string;
  studentId: string;
}
export function enrollment(input: unknown): Enrollment {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ValidationError("Expected an enrolment object.");
  const data = input as Record<string, unknown>,
    uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    typeof data.courseId !== "string" ||
    typeof data.studentId !== "string" ||
    !uuid.test(data.courseId) ||
    !uuid.test(data.studentId)
  )
    throw new ValidationError(
      "Valid courseId and studentId UUIDs are required.",
    );
  const courseId = data.courseId.toLowerCase(),
    studentId = data.studentId.toLowerCase();
  return {
    id: createHash("sha256")
      .update(courseId + ":" + studentId)
      .digest("hex"),
    courseId,
    studentId,
  };
}
export function eventPayload(input: unknown): Enrollment {
  const expected = enrollment(input);
  if ((input as Record<string, unknown>).id !== expected.id)
    throw new ValidationError("Invalid event identity.");
  return expected;
}
export interface EnrollmentStore {
  commit(record: Enrollment): Promise<{ record: Enrollment; created: boolean }>;
}
export interface Publisher {
  publish(record: Enrollment): Promise<void>;
}
export interface Consumer {
  consume(record: Enrollment): Promise<void>;
}
