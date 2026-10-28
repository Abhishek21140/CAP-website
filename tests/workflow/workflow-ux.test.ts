import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../../lib/repositories/memory/memory-repository";
import { getPrdSeedData } from "../../lib/repositories/seed/prd-seed";
import type { SubmissionsRepository } from "../../lib/repositories/types";

describe("Workflow & UX Features: Repeated Flags, Duplicate Notices & Task Types", () => {
  const superAdmin = {
    id: "admin-s",
    name: "Super Admin",
    email: "admin@cap.example",
    role: "super_admin" as const,
  };

  let repo: SubmissionsRepository;

  before(async () => {
    const seed = getPrdSeedData();
    const workshop = seed.tasks.find((task) => task.id === "task-workshop");
    assert.ok(workshop, "Hybrid workshop task must be seeded");

    // This workflow verifies hybrid task submission and review, not expired-cutoff behavior.
    workshop.deadline = new Date(Date.now() + 30 * 86_400_000).toISOString();
    repo = new MemoryRepository(seed);
  });

  describe("1. Duplicate Notice & Repeated Flags Counter", () => {
    it("identifies duplicate proof link and matches other participant identity", async () => {
      // In seed data: submissions[8] shares Drive linkKey with Aarav Sharma (sub-001)
      const aaravDetail = await repo.getById("sub-001", superAdmin);
      assert.ok(aaravDetail.flags.duplicateLink, "Aarav's submission must have duplicateLink flag true");
      assert.ok(aaravDetail.duplicateNotice, "Must populate duplicateNotice");
      assert.notEqual(aaravDetail.duplicateNotice?.otherParticipantId, aaravDetail.participant.id);
      assert.ok(aaravDetail.duplicateNotice?.otherParticipantName, "Must include other participant's name");

      // Verify participantStats
      assert.ok(aaravDetail.participantStats, "Must include participantStats");
      assert.ok(aaravDetail.participantStats.duplicateFlagsCount >= 1, "Must have at least 1 duplicate flag count");
      assert.equal(typeof aaravDetail.participantStats.rejectionsCount, "number");
    });

    it("tracks participant rejection counts in participantStats", async () => {
      // Dev Patel in seed has a rejected submission
      const queue = await repo.list({ taskId: "task-poster", status: "rejected" }, superAdmin);
      assert.ok(queue.submissions.length > 0);
      const rejectedSub = queue.submissions[0];
      assert.ok(rejectedSub.id);

      const detail = await repo.getById(rejectedSub.id, superAdmin);
      assert.ok(detail.participantStats);
      assert.ok(detail.participantStats.rejectionsCount >= 1, "Rejection count must be at least 1");
    });
  });

  describe("2. Hybrid 'both' Task Type", () => {
    it("seeds hybrid 'both' task in repository filter options", async () => {
      const list = await repo.list({}, superAdmin);
      const workshopTask = list.filters.tasks.find((t) => t.id === "task-workshop");
      assert.ok(workshopTask, "task-workshop must be seeded");
      assert.equal(workshopTask.type, "both");
      assert.equal(workshopTask.maxPoints, 100);
    });

    it("allows submissions for 'both' tasks and permits active reviewer decisions", async () => {
      // Submit a hybrid task proof
      const sub = await repo.submit({
        taskId: "task-workshop",
        participantId: "CAP-0005",
        driveLink: "https://drive.google.com/file/d/1HybridProofSampleXYZ_12345/view",
      });

      assert.ok(sub && sub.id);
      assert.equal(sub.task.type, "both");

      const detail = await repo.getById(sub.id!, superAdmin);
      assert.equal(detail.task.type, "both");
      assert.equal(detail.permissions.canDecide, true, "Reviewer must be able to decide on hybrid 'both' task");

      // Super Admin reviews hybrid task
      const decided = await repo.decide(
        {
          id: sub.id!,
          decision: "approved",
          pointsAwarded: 95,
          versionNo: 1,
          expectedRev: detail.rev ?? 1,
          requestId: crypto.randomUUID(),
        },
        superAdmin
      );

      assert.equal(decided.rowStatus, "approved");
      assert.equal(decided.pointsAwarded, 95);
      assert.equal(decided.finalPoints, 95);
    });
  });
});
