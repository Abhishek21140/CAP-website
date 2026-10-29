import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../../lib/repositories/memory/memory-repository";
import { createTestDrizzleRepository } from "./setup-pglite";
import type { SubmissionsRepository } from "../../lib/repositories/types";
import type { AdminUser } from "../../lib/admin/types";
import type { PGlite } from "@electric-sql/pglite";

const superAdmin: AdminUser = {
  id: "admin-s",
  name: "Super Admin",
  email: "admin@cap.example",
  role: "super_admin",
};

const reviewer: AdminUser = {
  id: "admin-r",
  name: "R. Verma",
  email: "r.verma@cap.example",
  role: "reviewer",
};

/**
 * Covers the participant import / soft-delete / sorting / public-content
 * surface added for the admin workspace. Runs against both repository
 * implementations so memory and Postgres stay in parity.
 */
function runExtensionTests(
  name: string,
  factory: () => Promise<{ repo: SubmissionsRepository; pglite?: PGlite; cleanup?: () => Promise<void> }>
) {
  describe(`Repository Extensions: ${name}`, () => {
    let repo: SubmissionsRepository;
    let cleanupFn: (() => Promise<void>) | undefined;

    it("setup", async () => {
      const init = await factory();
      repo = init.repo;
      cleanupFn = init.cleanup;
    });

    it("imports participants, skips duplicate emails and reports invalid rows", async () => {
      const before = await repo.listParticipants({ pageSize: 1 });

      const result = await repo.importParticipants(
        [
          {
            name: "Imported Participant",
            email: "imported.participant@example.com",
            college: "IIT BHU",
            rollNumber: "IMP-0001",
          },
          {
            // Same email, different casing — must be skipped, not created twice.
            name: "Duplicate Participant",
            email: "IMPORTED.PARTICIPANT@example.com",
            college: "IIT BHU",
            rollNumber: "IMP-0002",
          },
          {
            name: "",
            email: "missing.name@example.com",
            college: "IIT BHU",
            rollNumber: "IMP-0003",
          },
          {
            name: "Bad Email",
            email: "not-an-email",
            college: "IIT BHU",
            rollNumber: "IMP-0004",
          },
        ],
        superAdmin
      );

      assert.equal(result.created, 1, "only the first row should be created");
      assert.equal(result.skipped, 1, "the case-insensitive duplicate should be skipped");
      assert.deepEqual(
        result.errors.map((error) => error.row),
        [3, 4],
        "invalid rows should be reported by their 1-based position"
      );

      const after = await repo.listParticipants({ pageSize: 1 });
      assert.equal(after.total, before.total + 1, "exactly one participant should be added");
    });

    it("imported participants are searchable with a generated CAP id", async () => {
      const found = await repo.listParticipants({ search: "imported.participant@example.com", pageSize: 10 });

      assert.equal(found.total, 1);
      const participant = found.participants[0];
      assert.match(participant.id, /^CAP-\d{4,}$/);
      assert.equal(participant.email, "imported.participant@example.com");
      assert.equal(typeof participant.tasksCompleted, "number");
      assert.equal(typeof participant.lateCount, "number");
    });

    it("soft-deleted participants are hidden by default and visible with includeDeleted", async () => {
      const found = await repo.listParticipants({ search: "imported.participant@example.com", pageSize: 10 });
      assert.equal(found.total, 1);

      await repo.softDeleteParticipant(found.participants[0].id, superAdmin);

      const hidden = await repo.listParticipants({ search: "imported.participant@example.com", pageSize: 10 });
      assert.equal(hidden.total, 0, "deleted participants are excluded by default");

      const visible = await repo.listParticipants({
        search: "imported.participant@example.com",
        pageSize: 10,
        includeDeleted: true,
      });
      assert.equal(visible.total, 1, "includeDeleted surfaces soft-deleted participants");

      await repo.restoreParticipant(visible.participants[0].id, superAdmin);

      const restored = await repo.listParticipants({ search: "imported.participant@example.com", pageSize: 10 });
      assert.equal(restored.total, 1, "restore makes the participant visible again");
    });

    it("sorts participants by totalPoints descending", async () => {
      const result = await repo.listParticipants({ sortField: "totalPoints", sortOrder: "desc", pageSize: 25 });

      assert.ok(result.participants.length > 1, "seed data should provide several participants");
      for (let index = 1; index < result.participants.length; index += 1) {
        assert.ok(
          result.participants[index - 1].totalPoints >= result.participants[index].totalPoints,
          "totalPoints should be non-increasing"
        );
      }
    });

    it("supports derived sorting by tasksCompleted and lateCount", async () => {
      const baseline = await repo.listParticipants({ pageSize: 10 });
      const byTasks = await repo.listParticipants({ sortField: "tasksCompleted", sortOrder: "desc", pageSize: 10 });
      const byLate = await repo.listParticipants({ sortField: "lateCount", sortOrder: "asc", pageSize: 10 });

      assert.equal(byTasks.total, baseline.total);
      assert.equal(byLate.total, baseline.total);
      assert.equal(byTasks.participants.length, baseline.participants.length);
    });

    it("exposes only published CMS content through getPublicContent", async () => {
      const content = await repo.getPublicContent();

      assert.ok(content.faqs.length > 0, "seeded FAQs should be published");
      assert.ok(content.faqs.every((faq) => faq.status === "published"));
      assert.ok(content.benefits.length > 0, "seeded benefits should be published");
      assert.ok(content.benefits.every((benefit) => benefit.status === "published"));
      assert.ok(Object.keys(content.programInfo).length > 0, "program info should be seeded");
      assert.ok(content.announcements.length > 0, "an announcement should be seeded");
    });

    it("creates, updates and reads back an authored quiz", async () => {
      const questions = [
        {
          id: "q1",
          question: "What is the CAP programme?",
          options: ["A campus ambassador programme", "A city"],
          points: 10,
          correctOptionIndex: 0,
        },
      ];

      const created = await repo.saveQuiz(
        {
          taskId: "task-poster",
          title: "Authored Quiz",
          description: "Created by an admin",
          durationMinutes: 20,
          questions,
        },
        superAdmin
      );
      assert.equal(created.taskId, "task-poster");
      assert.equal(created.questions.length, 1);
      assert.equal(created.questions[0].correctOptionIndex, 0);

      const fetched = await repo.getQuizById(created.id);
      assert.ok(fetched, "getQuizById should return the authored quiz");
      assert.equal(fetched.title, "Authored Quiz");
      assert.equal(fetched.durationMinutes, 20);

      // Participant-facing lookups strip the answer key.
      const sanitized = await repo.getQuizByTaskId("task-poster");
      assert.ok(sanitized);
      assert.equal(sanitized.questions[0].correctOptionIndex, undefined);

      const withKey = await repo.getQuizByTaskId("task-poster", false);
      assert.equal(withKey?.questions[0].correctOptionIndex, 0);

      // Saving again for the same task replaces the existing quiz.
      const replaced = await repo.saveQuiz(
        { taskId: "task-poster", title: "Authored Quiz v2", questions },
        superAdmin
      );
      assert.equal(replaced.id, created.id, "one quiz per task: the same row is reused");
      assert.equal(replaced.title, "Authored Quiz v2");
      assert.equal(replaced.description, "Created by an admin", "description is preserved when omitted");
      assert.equal(replaced.durationMinutes, 20, "duration is preserved when omitted");

      const all = await repo.listQuizzes();
      assert.equal(
        all.filter((quiz) => quiz.taskId === "task-poster").length,
        1,
        "listing should not expose duplicate quizzes for a task"
      );

      const patched = await repo.saveQuiz(
        { id: created.id, taskId: "task-poster", title: "Authored Quiz v3", questions },
        superAdmin
      );
      assert.equal(patched.id, created.id);
      assert.equal(patched.title, "Authored Quiz v3");
    });

    it("rejects quiz authoring for unknown tasks and deletes authored quizzes", async () => {
      await assert.rejects(
        () =>
          repo.saveQuiz(
            {
              taskId: "task-missing",
              title: "Missing Task Quiz",
              questions: [
                {
                  id: "q1",
                  question: "Does this task exist?",
                  options: ["Yes", "No"],
                  points: 5,
                  correctOptionIndex: 1,
                },
              ],
            },
            superAdmin
          ),
        /not found/i
      );

      const created = await repo.saveQuiz(
        {
          taskId: "task-workshop",
          title: "Deletable Quiz",
          questions: [
            {
              id: "q1",
              question: "Will this quiz be deleted?",
              options: ["Yes", "No"],
              points: 5,
              correctOptionIndex: 0,
            },
          ],
        },
        superAdmin
      );

      await repo.deleteQuiz(created.id, superAdmin);
      assert.equal(await repo.getQuizById(created.id), null);

      await assert.rejects(() => repo.deleteQuiz("quiz-missing", superAdmin), /not found/i);
    });

    it("refuses to delete a quiz that already has participant responses", async () => {
      const quiz = await repo.saveQuiz(
        {
          taskId: "task-workshop",
          title: "Attempted Quiz",
          questions: [
            {
              id: "q1",
              question: "Can this quiz be deleted after an attempt?",
              options: ["Yes", "No"],
              points: 5,
              correctOptionIndex: 1,
            },
          ],
        },
        superAdmin
      );

      await repo.submitQuiz({
        taskId: "task-workshop",
        participantId: "CAP-0001",
        answers: { q1: 1 },
        startedAt: new Date().toISOString(),
      });

      await assert.rejects(() => repo.deleteQuiz(quiz.id, superAdmin), /cannot be deleted/i);
      assert.ok(await repo.getQuizById(quiz.id), "the quiz must remain after a rejected delete");
    });

    it("partially updates tasks without resetting omitted fields", async () => {
      const before = await repo.getTaskById("task-workshop");
      assert.ok(before, "seed task should exist");

      const updated = await repo.updateTask("task-workshop", { state: "Live" }, superAdmin);
      assert.equal(updated.state, "Live");
      assert.equal(updated.type, before.type, "type must not reset to the create default");
      assert.equal(updated.maxPoints, before.maxPoints);
      assert.equal(updated.graceMinutes, before.graceMinutes);
      assert.equal(updated.penaltyRate, before.penaltyRate);
      assert.equal(updated.cutoffDays, before.cutoffDays);

      const restored = await repo.updateTask(
        "task-workshop",
        { state: before.state ?? "Draft" },
        superAdmin
      );
      assert.equal(restored.state, before.state ?? "Draft");
    });

    it("filters participants by tasksCompleted and lateCount", async () => {
      const sample = (await repo.listParticipants({ pageSize: 1 })).participants[0];
      assert.ok(sample, "seed data should provide a participant");

      const filtered = await repo.listParticipants({
        tasksCompleted: sample.tasksCompleted,
        lateCount: sample.lateCount,
        pageSize: 200,
      });

      assert.ok(filtered.participants.length > 0, "the sample's own combination must match");
      assert.ok(
        filtered.participants.every(
          (participant) =>
            participant.tasksCompleted === sample.tasksCompleted &&
            participant.lateCount === sample.lateCount
        ),
        "both derived filters must be applied"
      );
    });

    it("lists assigned participant counts with each task", async () => {
      const totalParticipants = (await repo.listParticipants({ pageSize: 1 })).total;
      const created = await repo.createTask(
        {
          title: "Assigned Count Task",
          maxPoints: 10,
          deadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        superAdmin
      );

      const tasks = await repo.listTasks();
      const createdTask = tasks.find((task) => task.id === created.id);
      assert.ok(createdTask, "the created task should be listed");
      assert.equal(
        createdTask.assignedCount,
        totalParticipants,
        "new tasks materialize an assignment for every participant"
      );

      const poster = tasks.find((task) => task.id === "task-poster");
      assert.ok(poster, "the seeded poster task should exist");
      assert.ok((poster.assignedCount ?? 0) > 0);
    });

    it("validates quiz start state, deadline and single attempt", async () => {
      const task = await repo.createTask(
        {
          title: "Quiz Start Validation",
          type: "quiz",
          maxPoints: 10,
          deadline: new Date(Date.now() + 60 * 60 * 1000),
          graceMinutes: 0,
          state: "Live",
        },
        superAdmin
      );
      await repo.saveQuiz(
        {
          taskId: task.id,
          title: "Start Validation Quiz",
          questions: [
            {
              id: "q1",
              question: "Can this quiz start?",
              options: ["Yes", "No"],
              points: 10,
              correctOptionIndex: 0,
            },
          ],
        },
        superAdmin
      );

      const started = await repo.startQuiz(task.id, "CAP-0002");
      assert.equal(started.questions[0].correctOptionIndex, undefined, "the answer key must stay hidden");

      await repo.updateTask(task.id, { state: "Draft" }, superAdmin);
      await assert.rejects(() => repo.startQuiz(task.id, "CAP-0003"), /not open/i);

      await repo.updateTask(
        task.id,
        { state: "Live", deadline: new Date(Date.now() - 60 * 60 * 1000) },
        superAdmin
      );
      await assert.rejects(() => repo.startQuiz(task.id, "CAP-0003"), /deadline/i);

      await repo.updateTask(
        task.id,
        { deadline: new Date(Date.now() + 60 * 60 * 1000) },
        superAdmin
      );
      assert.ok(await repo.startQuiz(task.id, "CAP-0002"));
      await repo.submitQuiz({
        taskId: task.id,
        participantId: "CAP-0002",
        answers: { q1: 0 },
        startedAt: new Date().toISOString(),
      });
      await assert.rejects(() => repo.startQuiz(task.id, "CAP-0002"), /already/i);
    });

    it("only exposes announcements inside their publish window", async () => {
      const hour = 60 * 60 * 1000;
      const future = await repo.saveAnnouncement(
        {
          id: "announcement-future-test",
          title: "Future announcement",
          body: "Not yet visible.",
          status: "published",
          publishFrom: new Date(Date.now() + hour).toISOString(),
        },
        superAdmin
      );
      const expired = await repo.saveAnnouncement(
        {
          id: "announcement-expired-test",
          title: "Expired announcement",
          body: "No longer visible.",
          status: "published",
          publishTo: new Date(Date.now() - hour).toISOString(),
        },
        superAdmin
      );
      const active = await repo.saveAnnouncement(
        {
          id: "announcement-active-test",
          title: "Active announcement",
          body: "Visible now.",
          status: "published",
          publishFrom: new Date(Date.now() - hour).toISOString(),
          publishTo: new Date(Date.now() + hour).toISOString(),
        },
        superAdmin
      );

      const content = await repo.getPublicContent();
      assert.ok(!content.announcements.some((announcement) => announcement.id === future.id));
      assert.ok(!content.announcements.some((announcement) => announcement.id === expired.id));
      assert.ok(content.announcements.some((announcement) => announcement.id === active.id));
    });

    it("requires Super Admin confirmation before publishing gated content", async () => {
      await assert.rejects(
        () =>
          repo.saveFaq(
            {
              id: "faq-confirmation-test",
              group: "benefits",
              question: "Gated question?",
              answer: "Gated answer.",
              status: "published",
              requiresConfirmation: true,
            },
            reviewer
          ),
        /Super Admin confirmation/i
      );

      const faq = await repo.saveFaq(
        {
          id: "faq-confirmation-test",
          group: "benefits",
          question: "Gated question?",
          answer: "Gated answer.",
          status: "published",
          requiresConfirmation: true,
        },
        superAdmin
      );
      assert.equal(faq.confirmedBy, superAdmin.id);
      assert.ok(faq.confirmedAt, "publishing records the confirmation timestamp");

      await assert.rejects(
        () =>
          repo.saveBenefit(
            {
              id: "benefit-confirmation-test",
              title: "Gated benefit",
              description: "Gated description.",
              tier: "experience",
              status: "published",
              requiresConfirmation: true,
            },
            reviewer
          ),
        /Super Admin confirmation/i
      );
    });

    it("filters the admin queue by participant across all tasks", async () => {
      const result = await repo.list({
        taskId: "all",
        participantId: "CAP-0002",
        pageSize: 200,
      });

      assert.ok(result.submissions.length > 0, "the participant should have assignments");
      assert.ok(
        result.submissions.every((submission) => submission.participant.id === "CAP-0002"),
        "no other participant's rows may leak into the result"
      );
    });

    it("cleanup", async () => {
      if (cleanupFn) await cleanupFn();
    });
  });
}

runExtensionTests("MemoryRepository", async () => {
  const repo = new MemoryRepository();
  repo.seedSync();
  return { repo };
});

runExtensionTests("DrizzleRepository (PGlite)", async () => {
  const { repo, pglite } = await createTestDrizzleRepository();
  return {
    repo,
    pglite,
    cleanup: async () => {
      await pglite.close();
    },
  };
});
