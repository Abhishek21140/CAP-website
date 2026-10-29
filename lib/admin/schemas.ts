import { z } from "zod";
import { ApiError } from "./auth";

/**
 * Helper to strictly validate input payloads against a Zod schema.
 * Rejects unknown properties and malformed inputs with HTTP 422 VALIDATION_ERROR.
 */
export function parseStrict<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const field = firstIssue?.path.join(".") || "body";
    const msg = firstIssue?.message || "Invalid input";
    throw new ApiError(422, "VALIDATION_ERROR", `${field}: ${msg}`, result.error.flatten());
  }
  return result.data;
}

export const submitSchema = z
  .object({
    taskId: z.string().min(1, "taskId is required").max(64),
    participantId: z.string().min(1, "participantId is required").max(64),
    driveLink: z.string().min(1, "driveLink is required").max(2000),
    notes: z.string().max(2000).nullable().optional(),
    requestId: z.string().max(128).optional(),
  })
  .strict();

export const resubmitSchema = z
  .object({
    participantId: z.string().min(1, "participantId is required").max(64).optional(),
    driveLink: z.string().min(1, "driveLink is required").max(2000),
    notes: z.string().max(2000).nullable().optional(),
    expectedRev: z.number().int("expectedRev must be an integer").nonnegative("expectedRev must be non-negative"),
    requestId: z.string().max(128).optional(),
  })
  .strict();

export const reviewDecisionSchema = z
  .object({
    decision: z.enum(["approved", "needs_changes", "rejected"], {
      message: "decision must be 'approved', 'needs_changes', or 'rejected'",
    }),
    pointsAwarded: z.number().int("pointsAwarded must be an integer").nullable().optional(),
    reasonFeedback: z.string().max(2000).nullable().optional(),
    versionNo: z.number().int("versionNo must be an integer").positive("versionNo must be positive"),
    expectedRev: z.number().int("expectedRev must be an integer").nonnegative("expectedRev must be non-negative"),
    requestId: z.string().min(1, "requestId is required").max(128),
  })
  .strict();

export const assignReviewerSchema = z
  .object({
    reviewerId: z.string().max(64).nullable(),
    expectedRev: z.number().int("expectedRev must be an integer").nonnegative("expectedRev must be non-negative"),
    requestId: z.string().max(128).optional(),
  })
  .strict();

export const reopenSchema = z
  .object({
    expectedRev: z.number().int("expectedRev must be an integer").nonnegative("expectedRev must be non-negative"),
    reason: z.string().min(10, "Please provide at least 10 characters for reopening").max(2000),
    requestId: z.string().min(1, "requestId is required").max(128),
  })
  .strict();

export const reviseDecisionSchema = z
  .object({
    decision: z.enum(["approved", "needs_changes", "rejected"], {
      message: "decision must be 'approved', 'needs_changes', or 'rejected'",
    }),
    pointsAwarded: z.number().int("pointsAwarded must be an integer").nullable().optional(),
    reasonFeedback: z.string().min(5, "Please provide at least 5 characters explaining the decision revision").max(2000),
    expectedRev: z.number().int("expectedRev must be an integer").nonnegative("expectedRev must be non-negative"),
    requestId: z.string().max(128).optional(),
  })
  .strict();

export const bulkApproveItemSchema = z
  .object({
    id: z.string().min(1, "id is required").max(64),
    versionNo: z.number().int("versionNo must be an integer").positive("versionNo must be positive").optional(),
    expectedRev: z.number().int("expectedRev must be an integer").nonnegative("expectedRev must be non-negative"),
    pointsAwarded: z.number().int("pointsAwarded must be an integer").nullable().optional(),
    requestId: z.string().max(128).optional(),
  })
  .strict();

export const bulkApproveSchema = z
  .object({
    items: z
      .array(bulkApproveItemSchema)
      .min(1, "At least one submission is required")
      .max(200, "Maximum 200 submissions can be approved at once"),
    comment: z.string().max(1000).nullable().optional(),
    requestId: z.string().max(128).optional(),
  })
  .strict();

export const grantExtensionSchema = z
  .object({
    taskId: z.string().min(1, "taskId is required").max(64),
    participantId: z.string().min(1, "participantId is required").max(64),
    newDeadline: z.string().min(1, "newDeadline is required").max(64),
    reason: z.string().min(5, "Extension reason must be at least 5 characters").max(2000),
    groupLabel: z.string().max(255).nullable().optional(),
  })
  .strict();

export const scoreAdjustmentSchema = z
  .object({
    participantId: z.string().min(1, "participantId is required").max(64),
    submissionId: z.string().max(64).nullable().optional(),
    pointsDelta: z.number().int("pointsDelta must be an integer").refine((n) => n !== 0, {
      message: "pointsDelta must be a non-zero integer",
    }),
    reason: z.string().min(5, "Adjustment reason must be at least 5 characters").max(2000),
    requestId: z.string().max(128).optional(),
  })
  .strict();

export const freezeLeaderboardSchema = z
  .object({
    action: z.enum(["freeze", "unfreeze"], {
      message: "action must be 'freeze' or 'unfreeze'",
    }),
    reason: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.action === "freeze") {
        return typeof data.reason === "string" && data.reason.trim().length >= 5;
      }
      return true;
    },
    {
      message: "Reason of at least 5 characters is required to freeze leaderboard.",
      path: ["reason"],
    }
  );

export const publishLeaderboardSchema = z
  .object({
    isFinal: z.boolean().optional(),
    announceResults: z.boolean().optional(),
  })
  .strict();

export const personaSwitchSchema = z
  .object({
    persona: z.string().min(1, "persona is required").max(50),
  })
  .strict();

export const addAdminUserSchema = z
  .object({
    email: z.string().email("Valid email is required").max(255),
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    role: z.enum(["reviewer", "viewer", "super_admin"], {
      message: "Role must be 'reviewer', 'viewer', or 'super_admin'",
    }),
  })
  .strict();

export const registerParticipantSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    email: z.string().email("Valid email is required").max(255),
    phone: z.string().min(10, "Phone number must be at least 10 digits").max(20).optional(),
    college: z.string().min(2, "College name is required").max(200),
    branch: z.string().max(100).optional(),
    year: z.string().max(20).optional(),
    city: z.string().max(100).optional(),
    rollNumber: z.string().min(1, "Roll number is required").max(50),
    socialHandles: z.record(z.string(), z.string()).optional(),
    termsAccepted: z.boolean().refine((val) => val === true, {
      message: "You must accept the terms and privacy notice",
    }),
  })
  .strict();

export const loginParticipantSchema = z
  .object({
    email: z.string().email("Valid email is required"),
    rollNumber: z.string().optional(),
  })
  .strict();

export const updateParticipantSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    phone: z.string().max(20).nullable().optional(),
    college: z.string().min(2).max(200).optional(),
    branch: z.string().max(100).nullable().optional(),
    year: z.string().max(20).nullable().optional(),
    city: z.string().max(100).nullable().optional(),
    rollNumber: z.string().max(50).optional(),
    status: z.enum(["Pending Approval", "Active", "Inactive"]).optional(),
    socialHandles: z.record(z.string(), z.string()).nullable().optional(),
  })
  .strict();

export const importParticipantsSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            name: z.string().min(1, "Name is required").max(100),
            email: z.string().email("Valid email is required").max(255),
            phone: z.string().max(20).optional(),
            college: z.string().min(1, "College is required").max(200),
            branch: z.string().max(100).optional(),
            year: z.string().max(20).optional(),
            city: z.string().max(100).optional(),
            rollNumber: z.string().min(1, "Roll number is required").max(50),
            socialHandles: z.record(z.string(), z.string()).optional(),
            status: z.enum(["Pending Approval", "Active", "Inactive"]).optional(),
          })
          .strict()
      )
      .min(1, "At least one row is required")
      .max(5000, "Import is limited to 5000 rows per request"),
    preview: z.boolean().optional(),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: z.string().min(3, "Title must be at least 3 characters").max(200),
    description: z.string().max(5000).optional(),
    type: z.enum(["proof_link", "quiz", "both"]).default("proof_link"),
    maxPoints: z.number().int().positive("maxPoints must be greater than 0"),
    deadline: z.string().min(10, "Valid deadline is required"),
    graceMinutes: z.number().int().nonnegative().default(60),
    penaltyRate: z.number().int().min(0).max(100).default(10),
    penaltyCap: z.number().int().min(0).max(100).default(50),
    cutoffDays: z.number().int().min(0).max(30).default(3),
    correctionWindowDays: z.number().int().min(0).max(30).default(3),
    isMandatory: z.boolean().default(true),
    assignedTo: z.string().default("all"),
    state: z.enum(["Draft", "Scheduled", "Live", "Closed", "Archived"]).default("Draft"),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z.string().min(3, "Title must be at least 3 characters").max(200).optional(),
    description: z.string().max(5000).optional(),
    type: z.enum(["proof_link", "quiz", "both"]).optional(),
    maxPoints: z.number().int().positive("maxPoints must be greater than 0").optional(),
    deadline: z.string().min(10, "Valid deadline is required").optional(),
    graceMinutes: z.number().int().nonnegative().optional(),
    penaltyRate: z.number().int().min(0).max(100).optional(),
    penaltyCap: z.number().int().min(0).max(100).optional(),
    cutoffDays: z.number().int().min(0).max(30).optional(),
    correctionWindowDays: z.number().int().min(0).max(30).optional(),
    isMandatory: z.boolean().optional(),
    assignedTo: z.string().optional(),
    state: z.enum(["Draft", "Scheduled", "Live", "Closed", "Archived"]).optional(),
  })
  .strict();

export const submitQuizSchema = z
  .object({
    taskId: z.string().min(1, "taskId is required"),
    participantId: z.string().min(1, "participantId is required"),
    answers: z.record(z.string(), z.number()),
    startedAt: z.string().min(10, "startedAt is required"),
  })
  .strict();

export const quizQuestionSchema = z
  .object({
    id: z.string().min(1, "Question id is required").max(64),
    question: z.string().min(3, "Question text must be at least 3 characters").max(1000),
    options: z.array(z.string().min(1).max(500)).min(2).max(8),
    points: z.number().int().positive("points must be greater than 0").max(1000),
    correctOptionIndex: z.number().int().nonnegative("correctOptionIndex must be non-negative"),
  })
  .strict()
  .refine((question) => question.correctOptionIndex < question.options.length, {
    message: "correctOptionIndex must reference an existing option",
    path: ["correctOptionIndex"],
  });

export const saveQuizSchema = z
  .object({
    taskId: z.string().min(1, "taskId is required").max(64),
    title: z.string().min(3, "Title must be at least 3 characters").max(200),
    description: z.string().max(5000).nullable().optional(),
    durationMinutes: z.number().int().positive().max(600).optional(),
    questions: z
      .array(quizQuestionSchema)
      .min(1, "At least one question is required")
      .max(100)
      .refine(
        (questions) => new Set(questions.map((question) => question.id)).size === questions.length,
        { message: "question ids must be unique" }
      ),
  })
  .strict();

export const cmsFaqSchema = z
  .object({
    group: z.enum(["about", "benefits", "tasks", "points", "updates"]),
    question: z.string().min(3).max(500),
    answer: z.string().min(3).max(5000),
    displayOrder: z.number().int().default(0),
    status: z.enum(["draft", "published", "hidden"]).default("draft"),
    requiresConfirmation: z.boolean().default(false),
  })
  .strict();

export const cmsBenefitSchema = z
  .object({
    title: z.string().min(3).max(200),
    description: z.string().min(3).max(2000),
    icon: z.string().default("star"),
    tier: z.enum(["included", "experience", "merit_based"]).default("experience"),
    displayOrder: z.number().int().default(0),
    status: z.enum(["draft", "published", "hidden"]).default("draft"),
    requiresConfirmation: z.boolean().default(false),
  })
  .strict();

export const cmsProgramInfoSchema = z
  .object({
    key: z.string().min(1).max(64),
    value: z.string().min(1).max(2000),
    status: z.enum(["confirmed", "placeholder"]).default("placeholder"),
  })
  .strict();

export const cmsMilestoneSchema = z
  .object({
    label: z.string().min(2).max(200),
    phase: z.string().min(2).max(100),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    isPeak: z.boolean().default(false),
    displayOrder: z.number().int().default(0),
    status: z.enum(["draft", "published", "hidden"]).default("draft"),
  })
  .strict();

export const cmsTestimonialSchema = z
  .object({
    participantName: z.string().min(2).max(100),
    photoUrl: z.string().url().nullable().optional(),
    photoAlt: z.string().max(200).nullable().optional(),
    college: z.string().max(200).nullable().optional(),
    year: z.string().max(20).nullable().optional(),
    roleOrCohort: z.string().max(100).nullable().optional(),
    sourceLabel: z.enum(["alumni", "pilot", "organising_team"]),
    quote: z.string().min(5).max(1000),
    verifiedAchievement: z.string().max(200).nullable().optional(),
    consentStatus: z.enum(["granted", "withdrawn"]).default("granted"),
    status: z.enum(["draft", "published", "hidden"]).default("draft"),
    displayOrder: z.number().int().default(0),
  })
  .strict();

export const cmsAnnouncementSchema = z
  .object({
    title: z.string().min(3).max(200),
    body: z.string().min(5).max(5000),
    status: z.enum(["draft", "published", "archived"]).default("draft"),
    publishFrom: z.string().nullable().optional(),
    publishTo: z.string().nullable().optional(),
  })
  .strict();
