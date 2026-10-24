import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../../lib/repositories/memory/memory-repository";
import { createTestDrizzleRepository } from "../contract/setup-pglite";
import type { SubmissionsRepository } from "../../lib/repositories/types";
import type { AdminUser } from "../../lib/admin/types";
import { ApiError } from "../../lib/admin/auth";
import { PGlite } from "@electric-sql/pglite";
import { getPrdSeedData } from "../../lib/repositories/seed/prd-seed";

function createLifecycleSeed() {
  const seed = getPrdSeedData();
  const poster = seed.tasks.find((task) => task.id === "task-poster");
  assert.ok(poster, "Poster task must exist in lifecycle seed");

  // Keep the original demo timeline relationships while anchoring the cutoff
  // inside the current test window, so these lifecycle cases stay date agnostic.
  const originalDeadline = new Date(poster.deadline).getTime();
  const currentDeadline = Date.now() - 86_400_000;
  const shift = currentDeadline - originalDeadline;
  const shiftIso = (value: string) => new Date(new Date(value).getTime() + shift).toISOString();

  poster.deadline = new Date(currentDeadline).toISOString();
  for (const assignment of seed.taskAssignments) {
    if (assignment.taskId === poster.id) assignment.effectiveDeadlineAt = poster.deadline;
  }
  for (const submission of seed.submissions) {
    if (submission.taskId !== poster.id) continue;
    submission.submittedAt = shiftIso(submission.submittedAt);
    submission.firstSubmittedAt = shiftIso(submission.firstSubmittedAt);
    if (submission.correctionDeadline) submission.correctionDeadline = shiftIso(submission.correctionDeadline);
    if (submission.policySnapshot) submission.policySnapshot.deadline = poster.deadline;
    for (const historyItem of submission.history) historyItem.at = shiftIso(historyItem.at);
  }

  return seed;
}

const superAdmin: AdminUser = {
  id: "admin-s",
  name: "Super Admin",
  email: "admin@cap.example",
  role: "super_admin",
};

const reviewerUser: AdminUser = {
  id: "admin-r",
  name: "R. Verma",
  email: "r.verma@cap.example",
  role: "reviewer",
};

function runLifecycleContractTests(
  name: string,
  factory: () => Promise<{ repo: SubmissionsRepository; pglite?: PGlite; cleanup?: () => Promise<void> }>
) {
  describe(`Submission Lifecycle Contract: ${name}`, () => {
    let repo: SubmissionsRepository;
    let cleanupFn: (() => Promise<void>) | undefined;

    it("initializes repository", async () => {
      const init = await factory();
      repo = init.repo;
      cleanupFn = init.cleanup;
    });

    it("1. Submit: Creates first submission with valid Drive URL", async () => {
      // Find a participant with no submission for task-poster
      const list = await repo.list({ taskId: "task-poster", status: "missing" }, superAdmin);
      const missingRow = list.submissions[0];
      assert.ok(missingRow, "Should have missing rows");

      const submitted = await repo.submit({
        taskId: "task-poster",
        participantId: missingRow.participant.id,
        driveLink: "https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?usp=sharing",
        notes: "Here is my poster design submission.",
        requestId: crypto.randomUUID(),
      });

      assert.equal(submitted.versionNo, 1);
      assert.equal(submitted.rowStatus, "pending_review");
      assert.equal(submitted.versions.length, 1);
      assert.equal(submitted.versions[0].driveLink, "https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?usp=sharing");
      assert.ok(submitted.submittedAt);
      assert.equal(submitted.flags.duplicateLink, false);
    });

    it("2. Submit: Rejects invalid or insecure proof URLs", async () => {
      const list = await repo.list({ taskId: "task-poster", status: "missing" }, superAdmin);
      const missingRow = list.submissions[0];

      await assert.rejects(
        async () => {
          await repo.submit({
            taskId: "task-poster",
            participantId: missingRow.participant.id,
            driveLink: "http://insecure-http.com/doc",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 422);
          assert.equal(err.code, "INVALID_DRIVE_LINK");
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await repo.submit({
            taskId: "task-poster",
            participantId: missingRow.participant.id,
            driveLink: "https://randomsite.org/file.pdf",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 422);
          assert.equal(err.code, "INVALID_DRIVE_LINK");
          return true;
        }
      );
    });

    it("3. Submit: Detects duplicate Drive proof link across participants", async () => {
      const list = await repo.list({ taskId: "task-poster", status: "missing" }, superAdmin);
      const participantA = list.submissions[0].participant.id;
      const participantB = list.submissions[1].participant.id;

      const sharedDriveLink = "https://drive.google.com/file/d/shared-duplicate-file-12345/view";

      // First submit
      await repo.submit({
        taskId: "task-poster",
        participantId: participantA,
        driveLink: sharedDriveLink,
      });

      // Second submit with same link key
      const secondSubmit = await repo.submit({
        taskId: "task-poster",
        participantId: participantB,
        driveLink: sharedDriveLink,
      });

      assert.equal(secondSubmit.flags.duplicateLink, true, "Duplicate link flag must be true");
    });

    it("4. Submit: Rejects duplicate submit when submission already exists", async () => {
      const list = await repo.list({ taskId: "task-poster", status: "pending_review" }, superAdmin);
      const existing = list.submissions[0];

      await assert.rejects(
        async () => {
          await repo.submit({
            taskId: "task-poster",
            participantId: existing.participant.id,
            driveLink: "https://drive.google.com/file/d/another-link/view",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 409);
          assert.equal(err.code, "SUBMISSION_EXISTS");
          return true;
        }
      );
    });

    it("5. Submit: Rejects submission for auto-scored quiz task", async () => {
      const anyParticipant = (await repo.list({}, superAdmin)).submissions[0].participant.id;

      await assert.rejects(
        async () => {
          await repo.submit({
            taskId: "task-quiz",
            participantId: anyParticipant,
            driveLink: "https://drive.google.com/file/d/quiz-drive/view",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 422);
          assert.equal(err.code, "INVALID_TASK_TYPE");
          return true;
        }
      );
    });

    it("6. Resubmit: Full cycle from Needs Changes to v2 with Rule 6 Penalty Invariance", async () => {
      // Find a pending submission
      const pendingList = await repo.list({ taskId: "task-poster", status: "pending_review" }, superAdmin);
      const target = pendingList.submissions[0];
      const detailBefore = await repo.getById(target.id!, superAdmin);

      // Reviewer requests changes
      const afterChanges = await repo.decide(
        {
          id: target.id!,
          decision: "needs_changes",
          reasonFeedback: "The poster image resolution is too low. Please upload a high-res PDF.",
          versionNo: detailBefore.versionNo!,
          expectedRev: detailBefore.rev!,
          requestId: crypto.randomUUID(),
        },
        reviewerUser
      );

      assert.equal(afterChanges.rowStatus, "needs_changes");
      assert.ok(afterChanges.deadlines.correctionDeadline);

      // Record penalty metrics before resubmission
      const originalFirstSubmittedAt = detailBefore.submittedAt;
      assert.ok(originalFirstSubmittedAt);
      const originalPenaltyPoints = detailBefore.penaltyPoints;
      const originalTimingBadge = detailBefore.timing.badge;

      // Participant resubmits with v2
      const resubmitted = await repo.resubmit({
        submissionId: target.id!,
        participantId: target.participant.id,
        driveLink: "https://drive.google.com/file/d/high-res-poster-v2-link/view",
        notes: "Uploaded the 300 DPI version as requested.",
        expectedRev: afterChanges.rev!,
        requestId: crypto.randomUUID(),
      });

      assert.equal(resubmitted.versionNo, 2, "Version number should increment to 2");
      assert.equal(resubmitted.rowStatus, "pending_review", "Status should revert to pending_review");
      assert.equal(resubmitted.versions.length, 2, "Should have 2 versions in history");
      assert.equal(resubmitted.versions[1].driveLink, "https://drive.google.com/file/d/high-res-poster-v2-link/view");
      assert.equal(resubmitted.deadlines.correctionDeadline, null, "Correction deadline should be cleared");

      // RULE 6 CHECK: Penalty invariance!
      assert.equal(resubmitted.penaltyPoints, originalPenaltyPoints, "Penalty points must remain invariant across resubmissions");
      assert.equal(resubmitted.timing.badge, originalTimingBadge, "Timing badge must remain invariant");

      // Verify history contains resubmission event
      const resubmitHistory = resubmitted.history.find((h) => h.type === "resubmission" && h.versionNo === 2);
      assert.ok(resubmitHistory, "History must contain resubmission event for v2");
    });

    it("7. Resubmit: Rejects resubmission on illegal review status", async () => {
      // Find an approved submission
      const approvedList = await repo.list({ taskId: "task-poster", status: "approved" }, superAdmin);
      const approved = approvedList.submissions[0];

      await assert.rejects(
        async () => {
          await repo.resubmit({
            submissionId: approved.id!,
            participantId: approved.participant.id,
            driveLink: "https://drive.google.com/file/d/some-link/view",
            expectedRev: approved.rev!,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 422);
          assert.equal(err.code, "INVALID_TRANSITION");
          return true;
        }
      );
    });

    it("8. Extension (Rule 7): Super Admin grants extension recalculating late penalty", async () => {
      // Find a late submission
      const lateList = await repo.list({ taskId: "task-poster", status: "late" }, superAdmin);
      assert.ok(lateList.submissions.length > 0, "Should have late submissions in seed");
      const lateSub = lateList.submissions[0];

      assert.ok(lateSub.timing.isLate, "Target submission must be late");
      assert.ok((lateSub.penaltyPoints ?? 0) > 0, "Target submission must have penalty points");

      // Super Admin extends deadline by 7 days into the future (past submission time)
      const extendedDeadline = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const extResult = await repo.grantExtension(
        {
          taskId: lateSub.task.id,
          participantId: lateSub.participant.id,
          newDeadline: extendedDeadline,
          reason: "Approved university exam conflict extension.",
        },
        superAdmin
      );

      assert.equal(extResult.penaltyRecalculated, true);

      // Verify submission penalty is now 0 (recalculated against new deadline)
      const updated = await repo.getById(lateSub.id!, superAdmin);
      assert.equal(updated.timing.isLate, false, "Should no longer be late after extension");
      assert.equal(updated.penaltyPoints, 0, "Late penalty points should be recalculated to 0");
      assert.equal(updated.deadlines.effectiveDeadline, extendedDeadline);
    });

    it("9. Extension: Rejects extension grant from non-super-admin", async () => {
      await assert.rejects(
        async () => {
          await repo.grantExtension(
            {
              taskId: "task-poster",
              participantId: "some-part",
              newDeadline: new Date(Date.now() + 86_400_000).toISOString(),
              reason: "Regular reviewer granting extension.",
            },
            reviewerUser
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 403);
          assert.equal(err.code, "FORBIDDEN");
          return true;
        }
      );
    });

    it("10. Extension: Rejects extension with deadline earlier than task deadline", async () => {
      const anyParticipant = (await repo.list({}, superAdmin)).submissions[0].participant.id;
      await assert.rejects(
        async () => {
          await repo.grantExtension(
            {
              taskId: "task-poster",
              participantId: anyParticipant,
              newDeadline: "2020-01-01T00:00:00.000Z",
              reason: "Invalid back-dated deadline.",
            },
            superAdmin
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 422);
          assert.equal(err.code, "INVALID_DEADLINE");
          return true;
        }
      );
    });

    it("11. Extension: Revoke extension reverts deadline and recalculates penalty", async () => {
      // Find another late submission
      const lateList = await repo.list({ taskId: "task-poster", status: "late" }, superAdmin);
      const lateSub = lateList.submissions.find((s) => (s.penaltyPoints ?? 0) > 0);
      assert.ok(lateSub);

      const originalPenalty = lateSub.penaltyPoints;

      // Grant extension
      const extendedDeadline = new Date(Date.now() + 10 * 86_400_000).toISOString();
      const grantResult = await repo.grantExtension(
        {
          taskId: lateSub.task.id,
          participantId: lateSub.participant.id,
          newDeadline: extendedDeadline,
          reason: "Temporary medical extension.",
        },
        superAdmin
      );

      // Verify penalty was 0
      const afterGrant = await repo.getById(lateSub.id!, superAdmin);
      assert.equal(afterGrant.penaltyPoints, 0);

      // Now revoke the extension
      const revokeResult = await repo.revokeExtension(grantResult.extensionId, superAdmin);
      assert.equal(revokeResult.revoked, true);
      assert.equal(revokeResult.penaltyRecalculated, true);

      // Verify penalty is reinstated back to original late penalty
      const afterRevoke = await repo.getById(lateSub.id!, superAdmin);
      assert.equal(afterRevoke.timing.isLate, true);
      assert.equal(afterRevoke.penaltyPoints, originalPenalty);
    });

    it("cleans up resources", async () => {
      if (cleanupFn) await cleanupFn();
    });
  });
}

runLifecycleContractTests("MemoryRepository", async () => {
  const repo = new MemoryRepository(createLifecycleSeed());
  return { repo };
});

runLifecycleContractTests("DrizzleRepository (PGlite)", async () => {
  const { repo, pglite } = await createTestDrizzleRepository(createLifecycleSeed());
  return {
    repo,
    pglite,
    cleanup: async () => {
      await pglite.close();
    },
  };
});
