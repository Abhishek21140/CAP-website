/**
 * Barrel export for the leaderboard engine.
 */
export {
  computePenalty,
  applyPenalty,
  roundHalfUp,
  roundHalfUpPoints,
  isSubmissionLocked,
} from "./penalty";

export {
  rankParticipants,
  compareParticipants,
  sameRank,
  assignTier,
  DEFAULT_TIER_THRESHOLDS,
} from "./ranking";
export type { TierThresholds } from "./ranking";

export {
  recordSubmission,
  reviewSubmission,
  reopenRejectedSubmission,
  calculateSubmissionPenalty,
  scoreSubmission,
  grantDeadlineExtension,
  revokeDeadlineExtension,
  recalculateParticipantAggregates,
  recalculateFullLeaderboard,
  getLeaderboardState,
  freezeLeaderboard,
  unfreezeLeaderboard,
  publishFinalResults,
  applyScoreAdjustment,
  getPublicLeaderboard,
  getAdminLeaderboard,
  getParticipantScoreBreakdown,
  PUBLIC_CACHE_TTL_SECONDS,
  MIN_REASON_LENGTH,
  CORRECTION_WINDOW_MS,
} from "./engine";
export type {
  RecordSubmissionInput,
  ReviewSubmissionInput,
  GrantExtensionInput,
} from "./engine";

export {
  verifyAdminSession,
  verifyParticipantSession,
  createSignedAdminToken,
  createSignedParticipantToken,
  safeCompareStrings,
  isValidUUID,
  getAdminSecret,
  getSanitizedClientIp,
  checkRateLimit,
  isLockedOut,
  recordFailedAttempt,
  clearFailedAttempts,
  issueAdminSession,
  issueParticipantSession,
  refreshAdminSession,
  revokeSession,
  isSessionRevoked,
  clearRevocations,
  SYSTEM_ADMIN_UUID,
  INACTIVITY_TIMEOUT_MS,
  MAX_SESSION_LIFETIME_MS,
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MS,
  PARTICIPANT_TOKEN_TTL_MS,
} from "./auth";
export type {
  AdminRole,
  AdminSession,
  ParticipantSession,
  AdminTokenPayload,
  ParticipantTokenPayload,
} from "./auth";

export { writeAuditLog, writeAuditLogBatch } from "./audit";
export type { AuditEntry } from "./audit";

export type {
  PenaltyPolicy,
  PenaltyResult,
  ScoreResult,
  RankableParticipant,
  RankedParticipant,
  LeaderboardSnapshot,
  PublicLeaderboardRow,
  AdminLeaderboardRow,
  LeaderboardStatus,
  ParticipantScoreBreakdown,
  TaskScoreBreakdown,
} from "./types";
