import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  quizQuestionSchema,
  saveQuizSchema,
  updateTaskSchema,
} from "../../lib/admin/schemas";

/**
 * Regression coverage for partial-update payloads.
 *
 * Zod 4 keeps field defaults when a schema is wrapped with `.partial()`, so
 * `createTaskSchema.partial()` made `PATCH /api/admin/tasks/[id]` reset
 * omitted task fields to their create-time defaults. The dedicated update
 * schemas must therefore never inject values that were not sent.
 */
describe("Admin partial-update schemas", () => {
  it("does not inject create-time defaults into a partial task update", () => {
    const parsed = updateTaskSchema.parse({ state: "Live" });

    assert.deepEqual(parsed, { state: "Live" });
  });

  it("still rejects unknown keys on a partial task update", () => {
    assert.throws(() => updateTaskSchema.parse({ state: "Live", unexpected: true }));
  });

  it("does not inject durationMinutes into a partial quiz update", () => {
    const parsed = saveQuizSchema.partial().parse({ title: "Updated title" });

    assert.deepEqual(parsed, { title: "Updated title" });
  });

  it("rejects a correctOptionIndex outside the options list", () => {
    assert.throws(() =>
      quizQuestionSchema.parse({
        id: "q1",
        question: "Pick one",
        options: ["A", "B"],
        points: 5,
        correctOptionIndex: 2,
      })
    );
  });
});
