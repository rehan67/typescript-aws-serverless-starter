import type { Consumer, Enrollment, EnrollmentStore } from "./domain.js";
export class MemoryStore implements EnrollmentStore, Consumer {
  readonly records = new Map<string, Enrollment>();
  readonly outbox: Enrollment[] = [];
  readonly mailbox = new Map<string, Enrollment>();
  deliveries = 0;
  async commit(record: Enrollment) {
    const existing = this.records.get(record.id);
    if (existing) return { record: existing, created: false };
    this.records.set(record.id, record);
    this.outbox.push(record);
    return { record, created: true };
  }
  async consume(record: Enrollment) {
    this.deliveries++;
    if (!this.mailbox.has(record.id)) this.mailbox.set(record.id, record);
  }
  private draining: Promise<void> | undefined;
  drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      while (this.outbox.length) {
        await this.consume(this.outbox[0]!);
        this.outbox.shift();
      }
    })().finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }
}
