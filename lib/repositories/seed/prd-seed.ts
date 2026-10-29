import { calculateFinalScore, calculateSubmissionPenalty, describePenalty } from "@/lib/review-engine/penalty-calculator";
import type { AdminUser, Decision, HistoryItem, Participant, Submission, Task } from "@/lib/admin/types";
import { getCmsSeedData } from "./cms-seed";

export function getPrdSeedData() {
  const poster: Task = {
    id: "task-poster",
    title: "Campus Poster Challenge",
    type: "proof_link",
    maxPoints: 100,
    deadline: "2026-10-20T18:29:00.000Z", // Oct 20, 11:59 PM IST
    graceMinutes: 60,
    penaltyRate: 10,
    penaltyCap: 50,
    cutoffDays: 3,
    correctionWindowDays: 3,
    assignedTo: "all",
    state: "Live",
  };

  const quiz: Task = {
    id: "task-quiz",
    title: "Quiz 2: Entrepreneurship",
    type: "quiz",
    maxPoints: 50,
    deadline: "2026-10-27T18:29:00.000Z",
    graceMinutes: 60,
    penaltyRate: 10,
    penaltyCap: 50,
    cutoffDays: 3,
    correctionWindowDays: 3,
    assignedTo: "all",
    state: "Live",
  };

  // Use a far-future deadline so cutoff/deadline tests always pass regardless of run date
  const workshopDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const workshop: Task = {
    id: "task-workshop",
    title: "Startup Workshop & Assessment",
    type: "both",
    maxPoints: 100,
    deadline: workshopDeadline,
    graceMinutes: 60,
    penaltyRate: 10,
    penaltyCap: 50,
    cutoffDays: 3,
    correctionWindowDays: 3,
    assignedTo: "all",
    state: "Live",
  };


  const tasks: Task[] = [poster, quiz, workshop];

  const adminUsers: AdminUser[] = [
    { id: "admin-r", name: "R. Verma", role: "reviewer", email: "r.verma@cap.example" },
    { id: "admin-a", name: "A. Gupta", role: "reviewer", email: "a.gupta@cap.example" },
    { id: "admin-s", name: "Super Admin", role: "super_admin", email: "admin@cap.example" },
    { id: "admin-v", name: "Viewer", role: "viewer", email: "viewer@cap.example" },
  ];

  const colleges = ["IIT BHU", "NIT Patna", "BHU", "IIIT Allahabad", "MNNIT"];
  const names = [
    "Aarav Sharma",
    "Riya Verma",
    "Kabir Singh",
    "Meera Nair",
    "Dev Patel",
    "Ananya Rao",
    "Isha R.",
    "Vikram Joshi",
    "Sana Khan",
    "Arjun Mehta",
  ];
  const special = [
    ["Aarav Sharma", "24EE1001", "IIT BHU"],
    ["Riya Verma", "23CS2044", "NIT Patna"],
    ["Kabir Singh", "22EC3120", "BHU"],
    ["Meera Nair", "23IT0988", "IIIT Allahabad"],
    ["Dev Patel", "24ME4410", "MNNIT"],
    ["Isha R.", "24CS3312", "IIT BHU"],
  ] as const;

  const participants: Participant[] = Array.from({ length: 312 }, (_, index) => {
    const preset = special[index];
    const id = `CAP-${String(index + 1).padStart(4, "0")}`;
    const name =
      preset?.[0] ?? `${names[index % names.length]} ${String.fromCharCode(65 + Math.floor(index / names.length))}.`;
    return {
      id,
      name,
      email: preset
        ? `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".") }@example.test`
        : `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "")}.${index + 1}@example.test`,
      rollNumber: preset?.[1] ?? `${22 + (index % 3)}${["CS", "EE", "ME", "IT"][index % 4]}${String(1000 + index).slice(-4)}`,
      college: preset?.[2] ?? colleges[index % colleges.length],
      totalPoints: 0,
      rank: 0,
    };
  });

  const taskAssignments = participants.map((p) => ({
    taskId: poster.id,
    participantId: p.id,
    effectiveDeadlineAt: poster.deadline,
  }));

  const submissions: Submission[] = [];
  let serial = 1;

  function addSubmission(
    participantId: string,
    status: Submission["status"],
    isLate: boolean,
    assignedReviewerId: string | null,
    score?: number
  ) {
    const task = poster;
    const submittedAt = isLate ? "2026-10-21T18:00:00.000Z" : "2026-10-20T15:40:00.000Z";
    const penalty = calculateSubmissionPenalty(submittedAt, task);
    const final = score === undefined ? null : calculateFinalScore(score, penalty.penaltyPoints, task.maxPoints);
    const id = `sub-${String(serial++).padStart(3, "0")}`;
    const participant = participants.find((item) => item.id === participantId)!;
    const reviewer = assignedReviewerId ? adminUsers.find((item) => item.id === assignedReviewerId) : null;
    const history: HistoryItem[] = [
      {
        id: `${id}-submit`,
        type: "submitted",
        at: submittedAt,
        actor: participant.name,
        text: `Submitted version 1${penalty.isLate ? ` - ${penalty.timingLabel.toLowerCase()}, penalty fixed at ${describePenalty(penalty, task.maxPoints)}` : ""}.`,
        versionNo: 1,
      },
    ];

    if (score !== undefined) {
      history.push({
        id: `${id}-decision`,
        type: "decision",
        at: "2026-10-22T04:30:00.000Z",
        actor: reviewer?.name ?? "R. Verma",
        text: `${status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Requested changes"}.`,
        versionNo: 1,
        decision: status as Decision,
        pointsAwarded: score,
        penaltyApplied: final?.penaltyApplied ?? 0,
        finalPoints: final?.finalPoints ?? 0,
        reason: status === "needs_changes" ? "Please ensure the proof link is visible to reviewers." : undefined,
      });
    }

    submissions.push({
      id,
      participantId,
      taskId: task.id,
      driveLink: `https://drive.google.com/file/d/CAP-${participantId.slice(-4)}-proof/view`,
      linkKey: `CAP-${participantId.slice(-4)}-proof`,
      submittedAt,
      firstSubmittedAt: submittedAt,
      versionNo: 1,
      rev: 1,
      isLate: penalty.isLate,
      penaltyDays: penalty.penaltyDays,
      penaltyPercent: penalty.penaltyPercent,
      penaltyPoints: penalty.penaltyPoints,
      status,
      assignedReviewerId,
      pointsAwarded: score ?? null,
      penaltyApplied: final?.penaltyApplied ?? null,
      finalPoints: final?.finalPoints ?? null,
      correctionDeadline: status === "needs_changes" ? "2026-10-25T04:30:00.000Z" : null,
      policySnapshot: {
        deadline: task.deadline,
        graceMinutes: task.graceMinutes,
        penaltyRate: task.penaltyRate,
        penaltyCap: task.penaltyCap,
        maxPoints: task.maxPoints,
        cutoffDays: task.cutoffDays,
        correctionWindowDays: task.correctionWindowDays,
      },
      history,
    });
  }

  // 118 submitted (14 pending, 80 approved, 9 needs_changes, 15 rejected)
  for (let index = 0; index < 118; index++) {
    const status =
      index < 14
        ? "pending_review"
        : index < 94
        ? "approved"
        : index < 103
        ? "needs_changes"
        : "rejected";
    const late = index < 22;
    const assigned = index % 5 === 0 ? null : index % 2 ? "admin-r" : "admin-a";
    addSubmission(
      participants[index].id,
      status,
      late,
      assigned,
      status === "approved" ? 90 : status === "rejected" ? 0 : undefined
    );
  }

  // Pin wireframe rows
  const aarav = submissions[0];
  aarav.driveLink = "https://drive.google.com/file/d/1AaravPosterSample/view";
  aarav.linkKey = "shared-poster-proof";

  const kabir = submissions[2];
  kabir.status = "approved";
  kabir.pointsAwarded = 90;
  kabir.penaltyApplied = 0;
  kabir.finalPoints = 90;

  const meera = submissions[3];
  meera.status = "needs_changes";
  meera.correctionDeadline = "2026-10-25T04:30:00.000Z";

  const dev = submissions[4];
  dev.status = "rejected";
  dev.pointsAwarded = 0;
  dev.penaltyApplied = 0;
  dev.finalPoints = 0;

  const duplicate = submissions[8];
  duplicate.driveLink = aarav.driveLink;
  duplicate.linkKey = aarav.linkKey;

  for (const replacement of [submissions[14], submissions[94], submissions[103]]) {
    replacement.status = "pending_review";
    replacement.pointsAwarded = null;
    replacement.penaltyApplied = null;
    replacement.finalPoints = null;
    replacement.correctionDeadline = null;
  }

  kabir.submittedAt = kabir.firstSubmittedAt = "2026-10-20T15:40:00.000Z";
  kabir.isLate = false;
  kabir.penaltyDays = kabir.penaltyPercent = kabir.penaltyPoints = 0;

  meera.submittedAt = meera.firstSubmittedAt = "2026-10-20T18:28:00.000Z";
  meera.isLate = false;
  meera.penaltyDays = meera.penaltyPercent = meera.penaltyPoints = 0;

  for (const lateReplacement of [submissions[22], submissions[23]]) {
    lateReplacement.submittedAt = lateReplacement.firstSubmittedAt = "2026-10-21T18:00:00.000Z";
    const penalty = calculateSubmissionPenalty(lateReplacement.submittedAt, poster);
    lateReplacement.isLate = penalty.isLate;
    lateReplacement.penaltyDays = penalty.penaltyDays;
    lateReplacement.penaltyPercent = penalty.penaltyPercent;
    lateReplacement.penaltyPoints = penalty.penaltyPoints;
    if (lateReplacement.pointsAwarded !== null) {
      const final = calculateFinalScore(lateReplacement.pointsAwarded, penalty.penaltyPoints, poster.maxPoints);
      lateReplacement.penaltyApplied = final.penaltyApplied;
      lateReplacement.finalPoints = final.finalPoints;
    }
  }

  // Compute ranks
  participants.forEach((participant) => {
    participant.totalPoints = submissions
      .filter((sub) => sub.participantId === participant.id && sub.status === "approved")
      .reduce((sum, sub) => sum + (sub.finalPoints ?? 0), 0);
  });
  [...participants]
    .sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name))
    .forEach((participant, index) => {
      participant.rank = index + 1;
    });

  return {
    tasks,
    adminUsers,
    colleges,
    participants,
    taskAssignments,
    submissions,
    cms: getCmsSeedData(),
  };
}
