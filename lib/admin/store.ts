import { getRepository } from "@/lib/repositories";
import type { AdminUser, Decision } from "./types";
import type {
  BulkApproveParams,
  CreateScoreAdjustmentParams,
  GrantExtensionParams,
  ListSubmissionsQuery,
  ResubmitParams,
  ReviseDecisionParams,
  SubmitParams,
} from "@/lib/repositories/types";

export type ListQuery = ListSubmissionsQuery;

export async function listSubmissions(query: ListQuery = {}, user?: AdminUser) {
  const repo = getRepository();
  return repo.list(query, user);
}

export async function getSubmission(id: string, user: AdminUser) {
  const repo = getRepository();
  return repo.getById(id, user);
}

export async function decide(
  id: string,
  actor: AdminUser,
  body: {
    decision: Decision;
    pointsAwarded?: number;
    reasonFeedback?: string;
    versionNo: number;
    expectedRev: number;
    requestId: string;
  }
) {
  const repo = getRepository();
  return repo.decide({ id, ...body }, actor);
}

export async function assign(id: string, actor: AdminUser, reviewerId: string | null, expectedRev: number) {
  const repo = getRepository();
  return repo.assign(id, reviewerId, expectedRev, actor);
}

export async function reopen(
  id: string,
  actor: AdminUser,
  body: { expectedRev: number; reason: string; requestId: string }
) {
  const repo = getRepository();
  return repo.reopen(id, body.reason, body.expectedRev, body.requestId, actor);
}

export async function submitSubmission(params: SubmitParams) {
  const repo = getRepository();
  return repo.submit(params);
}

export async function resubmitSubmission(params: ResubmitParams) {
  const repo = getRepository();
  return repo.resubmit(params);
}

export async function grantExtension(params: GrantExtensionParams, actor: AdminUser) {
  const repo = getRepository();
  return repo.grantExtension(params, actor);
}

export async function revokeExtension(extensionId: string, actor: AdminUser) {
  const repo = getRepository();
  return repo.revokeExtension(extensionId, actor);
}

export async function bulkApproveSubmissions(params: BulkApproveParams, actor: AdminUser) {
  const repo = getRepository();
  return repo.bulkApprove(params, actor);
}

export async function reviseDecision(params: ReviseDecisionParams, actor: AdminUser) {
  const repo = getRepository();
  return repo.reviseDecision(params, actor);
}

export async function getLeaderboard(options?: { publicView?: boolean }) {
  const repo = getRepository();
  return repo.getLeaderboard(options);
}

export async function freezeLeaderboard(reason: string, actor: AdminUser) {
  const repo = getRepository();
  return repo.freezeLeaderboard(reason, actor);
}

export async function unfreezeLeaderboard(reason: string, actor: AdminUser) {
  const repo = getRepository();
  return repo.unfreezeLeaderboard(reason, actor);
}

export async function publishLeaderboard(isFinal: boolean, actor: AdminUser) {
  const repo = getRepository();
  return repo.publishLeaderboard(isFinal, actor);
}

export async function createScoreAdjustment(params: CreateScoreAdjustmentParams, actor: AdminUser) {
  const repo = getRepository();
  return repo.createScoreAdjustment(params, actor);
}

export async function listScoreAdjustments(participantId?: string) {
  const repo = getRepository();
  return repo.listScoreAdjustments(participantId);
}
