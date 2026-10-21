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
