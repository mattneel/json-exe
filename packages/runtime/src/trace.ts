import type { TraceRecord, TraceSink } from "./types";

/**
 * A simple in-memory trace collector. Pass an instance as `RunOptions.trace`
 * to accumulate execution records across multiple slot calls.
 */
export class Trace implements TraceSink {
  readonly records: TraceRecord[] = [];

  record(record: TraceRecord): void {
    this.records.push(record);
  }

  get last(): TraceRecord | undefined {
    return this.records[this.records.length - 1];
  }

  get ok(): boolean {
    return this.records.every((r) => r.ok);
  }

  clear(): void {
    this.records.length = 0;
  }

  toJSON(): TraceRecord[] {
    return this.records;
  }
}
