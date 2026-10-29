"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { calculateFinalScore } from "@/lib/review-engine/penalty-calculator";
import type { QueueRow } from "@/lib/admin/types";

const getInitialParam = (key: string, fallback: string = "") => {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(key) || fallback;
};
import type { BulkApproveResult, LeaderboardResult } from "@/lib/repositories/types";
import styles from "./admin.module.css";
import ParticipantsPanel from "./participants-panel";
import TasksPanel from "./tasks-panel";
import ContentPanel from "./content-panel";

type QueueResponse = {
  submissions: QueueRow[];
  counts: Record<string, number>;
  total: number;
  page: number;
  pageSize?: number;
  filters: {
    tasks: { id: string; title: string; maxPoints?: number }[];
    reviewers: { id: string; name: string }[];
    colleges: string[];
  };
};

type Detail = QueueRow & {
  versions?: { versionNo: number; driveLink: string; submittedAt: string; notes?: string | null }[];
  penaltyExplanation: string;
  history: {
    id: string;
    type: string;
    at: string;
    actor: string;
    text: string;
    versionNo: number;
    reason?: string;
    decision?: string;
    pointsAwarded?: number | null;
    penaltyApplied?: number | null;
    finalPoints?: number | null;
  }[];
  deadlines: { effectiveDeadline: string; correctionDeadline: string | null };
  permissions: {
    canDecide: boolean;
    canClaim: boolean;
    canRelease: boolean;
    canReassign: boolean;
    canReopen: boolean;
    canRevise: boolean;
    assignedReviewerName: string;
  };
  duplicateNotice?: {
    otherParticipantId: string;
    otherParticipantName: string;
  } | null;
  participantStats?: {
    duplicateFlagsCount: number;
    rejectionsCount: number;
  };
};

type Persona = "admin-r" | "admin-a" | "admin-s" | "admin-v";

export type AdminTeamUser = {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "reviewer" | "viewer";
  isActive: boolean;
  createdAt: string;
};
const chips = [
  ["all", "All"],
  ["pending_review", "Pending review"],
  ["approved", "Approved"],
  ["needs_changes", "Needs changes"],
  ["rejected", "Rejected"],
  ["late", "Late"],
  ["missing", "Missing"],
] as const;

const formatIST = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
        .format(new Date(date))
        .replace(/\u202f/g, " ")
    : "Not submitted";

const statusLabel = (status: string) =>
  ({
    pending_review: "Pending review",
    needs_changes: "Needs changes",
    approved: "Approved",
    rejected: "Rejected",
    missing: "Missing",
  }[status] ?? status);

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message ?? "Request failed"), {
      code: body.error?.code,
      details: body.error?.details,
      status: response.status,
    });
  }
  return body;
}

export default function AdminPage() {
  const router = useRouter();
  // Main queue & selection
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState("Submissions");

  // Filter state (URL-synced)
  const [taskId, setTaskId] = useState(() => getInitialParam("task", "task-poster"));
  const [status, setStatus] = useState(() => getInitialParam("status", "all"));
  const [search, setSearch] = useState(() => getInitialParam("q", ""));
  const [reviewer, setReviewer] = useState(() => getInitialParam("reviewer", ""));
  const [college, setCollege] = useState(() => getInitialParam("college", ""));
  const [page, setPage] = useState(() => {
    const p = parseInt(getInitialParam("page", "1"), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });
  const [pageSize, setPageSize] = useState(() => {
    const ps = parseInt(getInitialParam("pageSize", "50"), 10);
    return isNaN(ps) ? 50 : ps;
  });

  // Review Form & Decision inputs
  const [persona] = useState<Persona>("admin-s");
  const [points, setPoints] = useState("90");
  const [reason, setReason] = useState("");

  // Re-authentication modal state (preserves form feedback & points across session timeout)
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<(() => Promise<void>) | null>(null);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthing, setReauthing] = useState(false);

  // Keyboard navigation
  const [focusedRowIndex, setFocusedRowIndex] = useState(-1);

  // Mobile detection
  const isMobile = useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia("(max-width: 767px)");
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () => (typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false),
    () => false
  );

  // Bulk actions & Modal
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<"max" | "fixed">("max");
  const [bulkFixedPoints, setBulkFixedPoints] = useState("90");
  const [bulkComment, setBulkComment] = useState("");
  const [bulkResults, setBulkResults] = useState<BulkApproveResult | null>(null);

  // Concurrency conflict banner
  const [conflict, setConflict] = useState<{
    message: string;
    details?: { current?: { rev: number; versionNo: number; rowStatus: string } };
  } | null>(null);

  // Modals & Dialogs
  const [reopenMode, setReopenMode] = useState(false);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignReviewerId, setReassignReviewerId] = useState("");
  const [reviseModalOpen, setReviseModalOpen] = useState(false);
  const [reviseDecisionType, setReviseDecisionType] = useState<"approved" | "needs_changes" | "rejected">("approved");
  const [revisePoints, setRevisePoints] = useState("90");
  const [reviseReason, setReviseReason] = useState("");
  const [extensionMode, setExtensionMode] = useState(false);
  const [extDeadline, setExtDeadline] = useState("");
  const [extReason, setExtReason] = useState("");

  // Leaderboard state & dialogs
  const [leaderboard, setLeaderboard] = useState<LeaderboardResult | null>(null);
  const [lbSearch, setLbSearch] = useState("");
  const [freezeModal, setFreezeModal] = useState(false);
  const [freezeReason, setFreezeReason] = useState("");
  const [adjustmentModal, setAdjustmentModal] = useState(false);
  const [adjParticipantId, setAdjParticipantId] = useState("");
  const [adjPointsDelta, setAdjPointsDelta] = useState("");
  const [adjReason, setAdjReason] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);

  // Session User & Super Admin determination
  const [sessionUser, setSessionUser] = useState<{
    id: string;
    name: string;
    email: string;
    role: string;
  } | null>(null);

  const isViewer = sessionUser ? sessionUser.role === "viewer" : persona === "admin-v";

  const isSuperAdmin =
    (sessionUser && sessionUser.role === "super_admin") ||
    (!sessionUser && persona === "admin-s");

  const availableTabs = useMemo(() => {
    const base: [string, string][] = [
      ["▦", "Participants"],
      ["☷", "Submissions"],
      ["◷", "Task Store"],
      ["↗", "Leaderboard"],
      ["▤", "Content"],
    ];
    if (isSuperAdmin) {
      base.push(["👥", "Team & Access"]);
    }
    return base;
  }, [isSuperAdmin]);

  // Team & Access state (Super Admin exclusive)
  const [teamUsers, setTeamUsers] = useState<AdminTeamUser[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"reviewer" | "viewer">("reviewer");
  const [addingMember, setAddingMember] = useState(false);
  const [actingUserId, setActingUserId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await request<{
          authenticated: boolean;
          user: { id: string; name: string; email: string; role: string } | null;
        }>("/api/admin/session");
        if (res.authenticated && res.user) {
          setSessionUser(res.user);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // URL State Sync: Read selected submission on mount if ?sel is present
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const uSel = params.get("sel");

    if (uSel) {
      void (async () => {
        try {
          const detail = await request<Detail>(`/api/admin/submissions/${uSel}`);
          setSelected(detail);
          setPoints(detail.pointsAwarded?.toString() ?? detail.task.maxPoints.toString());
        } catch {
          // ignore if stale or invalid
        }
      })();
    }
  }, []);

  // 3. URL State Sync: Update URL on change
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (taskId && taskId !== "all") params.set("task", taskId);
    if (status && status !== "all") params.set("status", status);
    if (reviewer) params.set("reviewer", reviewer);
    if (college) params.set("college", college);
    if (search.trim()) params.set("q", search.trim());
    if (page > 1) params.set("page", String(page));
    if (pageSize !== 50) params.set("pageSize", String(pageSize));
    if (selected?.id) params.set("sel", selected.id);

    const qs = params.toString();
    const targetUrl = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", targetUrl);
  }, [taskId, status, reviewer, college, search, page, pageSize, selected]);

  // 4. Data loader for Submissions queue
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({
      taskId,
      status,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (search.trim().length >= 2) params.set("search", search.trim());
    if (reviewer) params.set("reviewerId", reviewer);
    if (college) params.set("college", college);

    try {
      const data = await request<QueueResponse>(`/api/admin/submissions?${params}`);
      setQueue(data);
      setFocusedRowIndex(-1);
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (err.status === 401 || err.code === "UNAUTHENTICATED") {
        router.push("/admin/login");
        return;
      }
      const msg = error instanceof Error ? error.message : "Could not load submissions.";
      setLoadError(msg);
      setNotice(msg);
    } finally {
      setLoading(false);
    }
  }, [taskId, status, page, pageSize, search, reviewer, college, router]);

  // 5. Data loader for Leaderboard
  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await request<LeaderboardResult>("/api/admin/leaderboard");
      setLeaderboard(data);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not load leaderboard.";
      setLoadError(msg);
      setNotice(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTeamUsers = useCallback(async () => {
    setLoadingTeam(true);
    setTeamError(null);
    try {
      const res = await request<{ users: AdminTeamUser[] }>("/api/admin/users");
      setTeamUsers(res.users);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load team users";
      setTeamError(msg);
    } finally {
      setLoadingTeam(false);
    }
  }, []);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = newMemberEmail.trim().toLowerCase();
    const trimmedName = newMemberName.trim();
    if (!trimmedEmail || !trimmedName) {
      setTeamError("Both name and Google email are required.");
      return;
    }
    setAddingMember(true);
    setTeamError(null);
    try {
      await request("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          role: newMemberRole,
        }),
      });
      setNewMemberName("");
      setNewMemberEmail("");
      setNotice(
        `Allowlisted ${trimmedEmail} as ${newMemberRole === "reviewer" ? "Reviewer" : "Viewer"}. They can now sign in with Google.`
      );
      await loadTeamUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add team member";
      setTeamError(msg);
    } finally {
      setAddingMember(false);
    }
  };

  const handleRevokeMember = async (user: AdminTeamUser) => {
    if (
      !confirm(
        `Revoke access for ${user.name} (${user.email})?\n\nThey will be blocked from logging into the Admin Portal.`
      )
    ) {
      return;
    }
    setActingUserId(user.id);
    setTeamError(null);
    try {
      await request(`/api/admin/users/${user.id}`, { method: "DELETE" });
      setNotice(`Access revoked for ${user.email}.`);
      await loadTeamUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to revoke access";
      setTeamError(msg);
    } finally {
      setActingUserId(null);
    }
  };

  const handleToggleActive = async (user: AdminTeamUser, targetActive: boolean) => {
    setActingUserId(user.id);
    setTeamError(null);
    try {
      await request(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: targetActive }),
      });
      setNotice(`${user.name} access is now ${targetActive ? "Active" : "Revoked"}.`);
      await loadTeamUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update member status";
      setTeamError(msg);
    } finally {
      setActingUserId(null);
    }
  };

  useEffect(() => {
    if (section === "Leaderboard") {
      const timer = window.setTimeout(() => void loadLeaderboard(), 0);
      return () => window.clearTimeout(timer);
    } else if (section === "Team & Access") {
      const timer = window.setTimeout(() => void loadTeamUsers(), 0);
      return () => window.clearTimeout(timer);
    } else if (section === "Submissions") {
      const timer = window.setTimeout(() => void load(), search ? 250 : 0);
      return () => window.clearTimeout(timer);
    }
  }, [section, load, search, loadLeaderboard, loadTeamUsers]);

  // Open submission detail panel
  const open = useCallback(async (row: QueueRow) => {
    const targetId = row.id ?? `missing:${row.task.id}:${row.participant.id}`;
    setConflict(null);
    try {
      const detail = await request<Detail>(`/api/admin/submissions/${targetId}`);
      setSelected(detail);
      setPoints(detail.pointsAwarded?.toString() ?? detail.task.maxPoints.toString());
      setRevisePoints(detail.pointsAwarded?.toString() ?? detail.task.maxPoints.toString());
      setReason("");
      setReviseReason("");
      setNotice("");
      setExtensionMode(false);
      setReopenMode(false);
      setReviseModalOpen(false);
      setReassignModalOpen(false);
      setReassignReviewerId(detail.assignedReviewer?.id ?? "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to open review panel.");
    }
  }, []);

  // 6. Keyboard navigation (PRD 6.2 A & Plan 13.4)
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // Disable shortcuts while typing in inputs
      if ((event.target as HTMLElement)?.matches("input,textarea,select")) return;

      // Close panels / dialogs on Escape
      if (event.key === "Escape") {
        setSelected(null);
        setBulkModalOpen(false);
        setReopenMode(false);
        setExtensionMode(false);
        setReviseModalOpen(false);
        setReassignModalOpen(false);
        setFreezeModal(false);
        setAdjustmentModal(false);
        setConflict(null);
        return;
      }

      // Focus search on "/"
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (section !== "Submissions" || !queue?.submissions) return;

      // Page Navigation: "[" (prev page), "]" (next page)
      if (event.key === "[") {
        event.preventDefault();
        setPage((p) => Math.max(1, p - 1));
        return;
      }
      if (event.key === "]") {
        event.preventDefault();
        const maxPages = Math.max(1, Math.ceil((queue.total ?? 0) / pageSize));
        setPage((p) => Math.min(maxPages, p + 1));
        return;
      }

      // Row Navigation: "j" or "ArrowDown" (down)
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedRowIndex((prev) => Math.min(prev + 1, queue.submissions.length - 1));
        return;
      }

      // Row Navigation: "k" or "ArrowUp" (up)
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedRowIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      // Open selected row on Enter
      if (event.key === "Enter") {
        event.preventDefault();
        if (focusedRowIndex >= 0 && queue.submissions[focusedRowIndex]) {
          void open(queue.submissions[focusedRowIndex]);
        }
        return;
      }

      // Open proof in new tab on "o"
      if (event.key === "o") {
        const row =
          selected ||
          (focusedRowIndex >= 0 && queue.submissions[focusedRowIndex] ? queue.submissions[focusedRowIndex] : null);
        if (row?.driveLink) {
          event.preventDefault();
          window.open(row.driveLink, "_blank", "noopener,noreferrer");
        }
      }
    };

    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [section, queue, pageSize, focusedRowIndex, selected, open]);

  const refreshDetail = async (id = selected?.id) => {
    if (id) {
      try {
        const detail = await request<Detail>(`/api/admin/submissions/${id}`);
        setSelected(detail);
        setConflict(null);
        setPoints(detail.pointsAwarded?.toString() ?? detail.task.maxPoints.toString());
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Could not reload submission.");
      }
    }
  };

  // Submit decision (Approve, Request Changes, Reject)
  const submitDecision = async (decision: "approved" | "needs_changes" | "rejected") => {
    if (!selected?.id || isMobile) return;
    setActing(true);
    setNotice("");
    setConflict(null);
    try {
      const result = await request<Detail>(`/api/admin/submissions/${selected.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          pointsAwarded: decision === "approved" ? Number(points) : undefined,
          reasonFeedback: reason,
          versionNo: selected.versionNo,
          expectedRev: selected.rev,
          requestId: crypto.randomUUID(),
        }),
      });
      setSelected(result);
      setNotice(`${statusLabel(decision)} saved. Scores and queue counts were recomputed.`);
      await load();
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (err.status === 401 || err.code === "UNAUTHORIZED") {
        setPendingRetry(() => () => submitDecision(decision));
        setReauthOpen(true);
        return;
      }
      if (err.code === "VERSION_CONFLICT" || err.status === 409) {
        setConflict({
          message: err.message || "This submission has changed. Reload the latest version.",
          details: err.details,
        });
      } else {
        setNotice(err.message || "Could not save decision.");
      }
    } finally {
      setActing(false);
    }
  };

  const claim = async () => {
    if (!selected?.id || isMobile) return;
    setActing(true);
    try {
      const result = await request<Detail>(`/api/admin/submissions/${selected.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ reviewerId: persona, expectedRev: selected.rev, requestId: crypto.randomUUID() }),
      });
      setSelected(result);
      setNotice("Assigned to you.");
      await load();
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (err.status === 401 || err.code === "UNAUTHORIZED") {
        setPendingRetry(() => claim);
        setReauthOpen(true);
        return;
      }
      setNotice(err.message || "Could not assign.");
    } finally {
      setActing(false);
    }
  };

  const release = async () => {
    if (!selected?.id || isMobile) return;
    setActing(true);
    try {
      const result = await request<Detail>(`/api/admin/submissions/${selected.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ reviewerId: null, expectedRev: selected.rev, requestId: crypto.randomUUID() }),
      });
      setSelected(result);
      setNotice("Reviewer assignment released.");
      await load();
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (err.status === 401 || err.code === "UNAUTHORIZED") {
        setPendingRetry(() => release);
        setReauthOpen(true);
        return;
      }
      setNotice(err.message || "Could not release assignment.");
    } finally {
      setActing(false);
    }
  };

  const submitReassign = async () => {
    if (!selected?.id || isMobile) return;
    setActing(true);
    try {
      const result = await request<Detail>(`/api/admin/submissions/${selected.id}/assign`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId: reassignReviewerId || null,
          expectedRev: selected.rev,
          requestId: crypto.randomUUID(),
        }),
      });
      setSelected(result);
      setReassignModalOpen(false);
      setNotice(`Reassigned to ${result.permissions.assignedReviewerName}.`);
      await load();
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (err.status === 401 || err.code === "UNAUTHORIZED") {
        setPendingRetry(() => submitReassign);
        setReauthOpen(true);
        return;
      }
      setNotice(err.message || "Could not reassign reviewer.");
    } finally {
      setActing(false);
    }
  };

  const submitRevise = async () => {
    if (!selected?.id || isMobile) return;
    if (reviseReason.trim().length < 5) {
      setNotice("Revision requires a reason of at least 5 characters.");
      return;
    }
    setActing(true);
    try {
      const result = await request<Detail>(`/api/admin/submissions/${selected.id}/revise`, {
        method: "POST",
        body: JSON.stringify({
          decision: reviseDecisionType,
          pointsAwarded: reviseDecisionType === "approved" ? Number(revisePoints) : undefined,
          reasonFeedback: reviseReason,
          expectedRev: selected.rev,
          requestId: crypto.randomUUID(),
        }),
      });
      setSelected(result);
      setReviseModalOpen(false);
      setReviseReason("");
      setNotice(`Decision revised to ${statusLabel(reviseDecisionType)}. Total scores and ranks updated.`);
      await load();
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (err.status === 401 || err.code === "UNAUTHORIZED") {
        setPendingRetry(() => submitRevise);
        setReauthOpen(true);
        return;
      }
      setNotice(err.message || "Could not revise decision.");
    } finally {
      setActing(false);
    }
  };

  // Bulk Approval confirmation execution
  const executeBulkApprove = async () => {
    if (!queue || selectedRowKeys.length === 0 || isMobile) return;
    setActing(true);
    setNotice("");
    try {
      const items = queue.submissions
        .filter((r) => selectedRowKeys.includes(r.rowKey) && r.id)
        .map((r) => ({
          id: r.id!,
          expectedRev: r.rev,
          pointsAwarded: bulkMode === "fixed" ? Number(bulkFixedPoints) : r.task.maxPoints,
        }));

      const res = await request<BulkApproveResult>("/api/admin/submissions/bulk-approve", {
        method: "POST",
        body: JSON.stringify({
          items,
          comment: bulkComment.trim() || undefined,
          requestId: crypto.randomUUID(),
        }),
      });

      setBulkResults(res);
      setBulkModalOpen(false);
      setSelectedRowKeys([]);
      setNotice(`Bulk approve finished: ${res.successCount} of ${res.totalRequested} approved.`);
      await load();
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (err.status === 401 || err.code === "UNAUTHORIZED") {
        setPendingRetry(() => executeBulkApprove);
        setReauthOpen(true);
        return;
      }
      setNotice(err.message || "Bulk approval failed.");
    } finally {
      setActing(false);
    }
  };

  const submitReopen = async () => {
    if (!selected?.id || isMobile) return;
    setActing(true);
    try {
      const result = await request<Detail>(`/api/admin/submissions/${selected.id}/reopen`, {
        method: "POST",
        body: JSON.stringify({ reason, expectedRev: selected.rev, requestId: crypto.randomUUID() }),
      });
      setSelected(result);
      setReopenMode(false);
      setReason("");
      setNotice("Submission reopened for review.");
      await load();
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (err.status === 401 || err.code === "UNAUTHORIZED") {
        setPendingRetry(() => submitReopen);
        setReauthOpen(true);
        return;
      }
      setNotice(err.message || "Could not reopen.");
    } finally {
      setActing(false);
    }
  };

  const submitExtension = async () => {
    if (!selected || isMobile) return;
    setActing(true);
    try {
      await request("/api/admin/extensions", {
        method: "POST",
        body: JSON.stringify({
          taskId: selected.task.id,
          participantId: selected.participant.id,
          newDeadline: new Date(extDeadline).toISOString(),
          reason: extReason,
        }),
      });
      setExtensionMode(false);
      setExtReason("");
      setNotice("Extension granted. Late penalties recalculated.");
      await refreshDetail(selected.id ?? undefined);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not grant extension.");
    } finally {
      setActing(false);
    }
  };

  // Leaderboard actions
  const submitFreeze = async () => {
    if (!freezeReason || freezeReason.trim().length < 5) {
      setNotice("Freeze requires a reason of at least 5 characters.");
      return;
    }
    setActing(true);
    try {
      await request("/api/admin/leaderboard/freeze", {
        method: "POST",
        body: JSON.stringify({ action: "freeze", reason: freezeReason }),
      });
      setFreezeModal(false);
      setFreezeReason("");
      setNotice("Leaderboard is now FROZEN. Public view serves the snapshot.");
      await loadLeaderboard();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not freeze leaderboard.");
    } finally {
      setActing(false);
    }
  };

  const submitUnfreeze = async () => {
    setActing(true);
    try {
      await request("/api/admin/leaderboard/freeze", {
        method: "POST",
        body: JSON.stringify({ action: "unfreeze" }),
      });
      setNotice("Leaderboard is now LIVE. Public view displays live updates.");
      await loadLeaderboard();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not unfreeze leaderboard.");
    } finally {
      setActing(false);
    }
  };

  const submitPublish = async (isFinal: boolean) => {
    setActing(true);
    try {
      await request("/api/admin/leaderboard/publish", {
        method: "POST",
        body: JSON.stringify({ isFinal }),
      });
      setNotice(
        isFinal
          ? "Final competition rankings published and locked."
          : "Leaderboard snapshot published for public view."
      );
      await loadLeaderboard();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not publish leaderboard.");
    } finally {
      setActing(false);
    }
  };

  const submitScoreAdjustment = async () => {
    if (!adjParticipantId || !adjPointsDelta || !adjReason || adjReason.trim().length < 10) {
      setNotice("Provide participant, non-zero points delta, and reason of at least 10 characters.");
      return;
    }
    const delta = parseInt(adjPointsDelta, 10);
    if (isNaN(delta) || delta === 0) {
      setNotice("Points delta must be a non-zero integer.");
      return;
    }
    setActing(true);
    try {
      await request("/api/admin/score-adjustments", {
        method: "POST",
        body: JSON.stringify({
          participantId: adjParticipantId,
          pointsDelta: delta,
          reason: adjReason.trim(),
        }),
      });
      setAdjustmentModal(false);
      setAdjParticipantId("");
      setAdjPointsDelta("");
      setAdjReason("");
      setNotice("Score adjustment applied. Participant totals and rankings recalculated.");
      await loadLeaderboard();
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not apply score adjustment.");
    } finally {
      setActing(false);
    }
  };

  const exportCsv = async () => {
    const params = new URLSearchParams({ taskId, status });
    if (search.trim().length >= 2) params.set("search", search.trim());
    if (reviewer) params.set("reviewerId", reviewer);
    if (college) params.set("college", college);
    const response = await fetch(`/api/admin/submissions/export?${params}`);
    if (!response.ok) {
      setNotice("CSV export could not be created.");
      return;
    }
    const href = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "cap-submissions.csv";
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const clearAllFilters = () => {
    setTaskId("all");
    setStatus("all");
    setReviewer("");
    setCollege("");
    setSearch("");
    setPage(1);
  };

  const computed = useMemo(() => {
    const awarded = Number(points);
    return selected && Number.isInteger(awarded) && awarded >= 0 && awarded <= selected.task.maxPoints
      ? calculateFinalScore(awarded, selected.penaltyPoints ?? 0, selected.task.maxPoints)
      : null;
  }, [points, selected]);

  const reviseComputed = useMemo(() => {
    const awarded = Number(revisePoints);
    return selected && Number.isInteger(awarded) && awarded >= 0 && awarded <= selected.task.maxPoints
      ? calculateFinalScore(awarded, selected.penaltyPoints ?? 0, selected.task.maxPoints)
      : null;
  }, [revisePoints, selected]);

  const selectableRows = useMemo(() => {
    return (
      queue?.submissions.filter(
        (r) => r.id && r.task.type !== "quiz" && r.rowStatus !== "missing" && r.rowStatus !== "approved"
      ) ?? []
    );
  }, [queue]);

  const allCurrentPageSelected = useMemo(() => {
    return (
      selectableRows.length > 0 &&
      selectableRows.every((r) => selectedRowKeys.includes(r.rowKey))
    );
  }, [selectableRows, selectedRowKeys]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil((queue?.total ?? 0) / pageSize));
  }, [queue?.total, pageSize]);

  const filteredLeaderboardEntries = useMemo(() => {
    if (!leaderboard) return [];
    if (!lbSearch.trim()) return leaderboard.entries;
    const query = lbSearch.toLowerCase().trim();
    return leaderboard.entries.filter(
      (e) =>
        e.name.toLowerCase().includes(query) ||
        e.participantId.toLowerCase().includes(query) ||
        e.college.toLowerCase().includes(query) ||
        e.rollNumber.toLowerCase().includes(query)
    );
  }, [leaderboard, lbSearch]);

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/admin" className={styles.brand}>
          <span>
            <strong>CAP Admin</strong>
            <small>PROGRAM OPERATIONS</small>
          </span>
        </Link>
        <div className={styles.account}>
          <form action="/api/auth/signout" method="POST" style={{ display: "inline" }}>
            <button
              type="submit"
              style={{
                background: "transparent",
                border: "1px solid #334155",
                color: "#94a3b8",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <span className={styles.eyebrow}>WORKSPACE</span>
          {availableTabs.map(([icon, name]) => (
            <button
              key={name}
              onClick={() => {
                setSection(name);
                setSelected(null);
                setConflict(null);
                setFreezeModal(false);
                setAdjustmentModal(false);
              }}
              className={`${styles.nav} ${section === name ? styles.navActive : ""}`}
            >
              <span>{icon}</span>
              {name}
              {name === "Submissions" && <i>{queue?.counts.pending_review ?? 14}</i>}
              {name === "Team & Access" && teamUsers.length > 0 && <i>{teamUsers.length}</i>}
            </button>
          ))}
          <div className={styles.role}>
            <span />Signed in as
            <strong>
              {sessionUser
                ? `${sessionUser.name} (${sessionUser.role === "super_admin" ? "Super Admin" : sessionUser.role === "reviewer" ? "Reviewer" : "Viewer"})`
                : persona === "admin-s"
                ? "Super Admin"
                : persona === "admin-v"
                ? "Viewer"
                : persona === "admin-r"
                ? "R. Verma"
                : "A. Gupta"}
            </strong>
            {sessionUser?.email && (
              <small style={{ display: "block", color: "#88949d", fontSize: 9, marginTop: 2, wordBreak: "break-all" }}>
                {sessionUser.email}
              </small>
            )}
          </div>
        </aside>

        <section className={styles.workspace}>
          {isMobile && (
            <div className={styles.mobileBanner} role="status">
              <span>📱</span>
              <span>
                <strong>Mobile View (Read-Only)</strong> — Decisions, revisions, and bulk actions require a tablet or desktop display.
              </span>
            </div>
          )}

          {section === "Leaderboard" ? (
            <>
              <div className={styles.heading}>
                <div>
                  <p className={styles.crumb}>WORKSPACE / LEADERBOARD & RANKINGS</p>
                  <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    Leaderboard
                    <span
                      className={
                        leaderboard?.state.status === "frozen"
                          ? styles.badgeFrozen
                          : leaderboard?.state.status === "final"
                          ? styles.badgeFinal
                          : styles.badgeLive
                      }
                    >
                      {leaderboard?.state.status.toUpperCase() ?? "LIVE"}
                    </span>
                  </h1>
                  <p>
                    {leaderboard?.state.status === "frozen"
                      ? `Leaderboard frozen on ${formatIST(leaderboard.state.frozenAt)}. Public view is fixed to snapshot.`
                      : leaderboard?.state.status === "final"
                      ? "Final competition rankings published and locked."
                      : "Live competition rankings recalculating in real-time under Section 11 tie-breaking rules."}
                  </p>
                </div>
                {!isViewer && persona === "admin-s" && (
                  <div className={styles.leaderboardActions}>
                    {leaderboard?.state.status === "live" ? (
                      <button
                        className={styles.actionBtnSecondary}
                        onClick={() => setFreezeModal(true)}
                        disabled={acting}
                      >
                        Freeze Leaderboard
                      </button>
                    ) : (
                      <button
                        className={styles.actionBtnSecondary}
                        onClick={() => void submitUnfreeze()}
                        disabled={acting}
                      >
                        Unfreeze Leaderboard
                      </button>
                    )}
                    <button
                      className={styles.actionBtnSecondary}
                      onClick={() => void submitPublish(false)}
                      disabled={acting}
                    >
                      Publish Snapshot
                    </button>
                    <button
                      className={styles.actionBtnSecondary}
                      onClick={() => void submitPublish(true)}
                      disabled={acting}
                    >
                      Publish Final
                    </button>
                    <button
                      className={styles.actionBtnPrimary}
                      onClick={() => setAdjustmentModal(true)}
                      disabled={acting}
                    >
                      + Score Adjustment
                    </button>
                  </div>
                )}
              </div>

              {notice && (
                <div className={styles.notice} role="alert">
                  <span>i</span>
                  {notice}
                  <button onClick={() => setNotice("")} aria-label="Dismiss alert">×</button>
                </div>
              )}

              {/* Freeze Dialog */}
              {freezeModal && (
                <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="freeze-title">
                  <div className={styles.modalBox}>
                    <div className={styles.modalHead}>
                      <div>
                        <h3 id="freeze-title">Freeze Leaderboard</h3>
                        <p>Lock public leaderboard to current snapshot while reviews continue.</p>
                      </div>
                      <button className={styles.modalClose} onClick={() => setFreezeModal(false)}>×</button>
                    </div>
                    <div className={styles.modalBody}>
                      <label className={styles.inputLabel} style={{ marginTop: 0 }}>
                        Reason for freezing <span>Minimum 5 characters</span>
                        <input
                          value={freezeReason}
                          onChange={(e) => setFreezeReason(e.target.value)}
                          placeholder="e.g. Final verification pass before closing ceremony…"
                        />
                      </label>
                    </div>
                    <div className={styles.modalFoot}>
                      <button className={styles.actionBtnSecondary} onClick={() => setFreezeModal(false)}>
                        Cancel
                      </button>
                      <button
                        className={styles.actionBtnPrimary}
                        disabled={acting || freezeReason.trim().length < 5}
                        onClick={() => void submitFreeze()}
                      >
                        {acting ? "Freezing…" : "Confirm Freeze"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Score Adjustment Dialog */}
              {adjustmentModal && (
                <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="adj-title">
                  <div className={styles.modalBox}>
                    <div className={styles.modalHead}>
                      <div>
                        <h3 id="adj-title">Manual Score Adjustment</h3>
                        <p>Super Admin adjustment directly credited or debited to participant score with audit.</p>
                      </div>
                      <button className={styles.modalClose} onClick={() => setAdjustmentModal(false)}>×</button>
                    </div>
                    <div className={styles.modalBody}>
                      <label className={styles.inputLabel} style={{ marginTop: 0 }}>
                        Participant ID
                        <input
                          value={adjParticipantId}
                          onChange={(e) => setAdjParticipantId(e.target.value)}
                          placeholder="e.g. CAP-0001"
                        />
                      </label>
                      <label className={styles.inputLabel}>
                        Points Delta <span>Positive or negative integer</span>
                        <input
                          value={adjPointsDelta}
                          onChange={(e) => setAdjPointsDelta(e.target.value)}
                          placeholder="+20 or -15"
                        />
                      </label>
                      <label className={styles.inputLabel}>
                        Audit Reason <span>Minimum 10 characters</span>
                        <textarea
                          value={adjReason}
                          onChange={(e) => setAdjReason(e.target.value)}
                          placeholder="Detailed reason for manual adjustment (stored in audit log)…"
                        />
                      </label>
                    </div>
                    <div className={styles.modalFoot}>
                      <button className={styles.actionBtnSecondary} onClick={() => setAdjustmentModal(false)}>
                        Cancel
                      </button>
                      <button
                        className={styles.actionBtnPrimary}
                        disabled={acting || !adjParticipantId || !adjPointsDelta || adjReason.trim().length < 10}
                        onClick={() => void submitScoreAdjustment()}
                      >
                        {acting ? "Applying…" : "Apply Adjustment"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className={styles.queue}>
                <div className={styles.toolbar}>
                  <div>
                    <h2>Participants Ranking</h2>
                    <p>Rankings calculated under Section 11 tie-breaking rules.</p>
                  </div>
                  <label className={styles.search}>
                    <span>⌕</span>
                    <input
                      value={lbSearch}
                      onChange={(e) => setLbSearch(e.target.value)}
                      placeholder="Filter by name, ID, college, roll number…"
                      aria-label="Filter leaderboard"
                    />
                  </label>
                </div>

                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>RANK</th>
                        <th>PARTICIPANT</th>
                        <th>COLLEGE</th>
                        <th>TASKS APPROVED</th>
                        <th>LATE TASKS</th>
                        <th>LAST SUBMISSION (IST)</th>
                        <th>ADJUSTMENTS</th>
                        <th>TOTAL POINTS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <tr key={i} className={styles.skeletonRow}>
                            <td><span className={styles.skeletonCell} style={{ width: 30 }} /></td>
                            <td><span className={styles.skeletonCell} /></td>
                            <td><span className={styles.skeletonCellShort} /></td>
                            <td><span className={styles.skeletonCellShort} /></td>
                            <td><span className={styles.skeletonCellShort} /></td>
                            <td><span className={styles.skeletonCell} /></td>
                            <td><span className={styles.skeletonCellShort} /></td>
                            <td><span className={styles.skeletonCellBadge} /></td>
                          </tr>
                        ))
                      ) : filteredLeaderboardEntries.length === 0 ? (
                        <tr>
                          <td colSpan={8}>
                            <div className={styles.emptyState}>
                              <span className={styles.emptyStateIcon}>🔍</span>
                              <strong>No participants found</strong>
                              <p>No results matched your search term &ldquo;{lbSearch}&rdquo;.</p>
                              <button className={styles.clearFiltersBtn} onClick={() => setLbSearch("")}>
                                Clear Search
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredLeaderboardEntries.map((row) => (
                          <tr key={row.participantId}>
                            <td>
                              <strong>#{row.rank}</strong>
                              {row.isTied && <span className={styles.tiedBadge}>TIED</span>}
                            </td>
                            <td>
                              <strong>
                                {row.name} <em>{row.participantId}</em>
                              </strong>
                              <small>{row.rollNumber}</small>
                            </td>
                            <td>{row.college}</td>
                            <td>{row.tasksCompleted}</td>
                            <td>
                              {row.lateCount > 0 ? (
                                <span className={styles.late}>{row.lateCount} late</span>
                              ) : (
                                "0"
                              )}
                            </td>
                            <td>{formatIST(row.lastSubmissionAt)}</td>
                            <td>
                              {row.scoreAdjustments > 0 ? (
                                <span className={styles.adjPos}>+{row.scoreAdjustments}</span>
                              ) : row.scoreAdjustments < 0 ? (
                                <span className={styles.adjNeg}>{row.scoreAdjustments}</span>
                              ) : (
                                "0"
                              )}
                            </td>
                            <td className={styles.final}>
                              <strong>{row.totalPoints}</strong>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <footer className={styles.tableFooter}>
                  Showing {filteredLeaderboardEntries.length} of {leaderboard?.totalParticipants ?? 0} participants{" "}
                  <span>PRD Standard Competition Rank (RANK()) · Section 11 Tie-Breaking</span>
                </footer>
              </div>
            </>
          ) : section === "Team & Access" ? (
            <>
              <div className={styles.heading}>
                <div>
                  <p className={styles.crumb}>SUPER ADMIN / ACCESS CONTROL & ALLOWLIST</p>
                  <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    Team & Access Management
                  </h1>
                  <p>
                    Control who can sign in to the Admin Portal with Google OAuth. Only explicitly allowlisted accounts can access this portal.
                  </p>
                </div>
                <div>
                  <button
                    type="button"
                    className={styles.export}
                    onClick={() => void loadTeamUsers()}
                    disabled={loadingTeam}
                  >
                    {loadingTeam ? "Refreshing..." : "↻ Refresh Team"}
                  </button>
                </div>
              </div>

              {teamError && (
                <div className={styles.errorBanner} role="alert">
                  <span>⚠️ {teamError}</span>
                  <button type="button" className={styles.retryBtn} onClick={() => setTeamError(null)}>
                    Dismiss
                  </button>
                </div>
              )}

              {/* Allowlist New Member Form */}
              <div className={styles.teamCard}>
                <div className={styles.teamCardHead}>
                  <div>
                    <h3>Allowlist New Team Member</h3>
                    <p>
                      Add a reviewer or viewer Google account. Only allowlisted emails can log in.
                    </p>
                  </div>
                </div>
                <form onSubmit={handleAddMember} className={styles.teamForm}>
                  <div className={styles.teamField}>
                    <label htmlFor="team-member-name">Full Name</label>
                    <input
                      id="team-member-name"
                      type="text"
                      className={styles.teamInput}
                      placeholder="e.g. Rahul Sharma"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      required
                    />
                  </div>
                  <div className={styles.teamField}>
                    <label htmlFor="team-member-email">Google Email Address</label>
                    <input
                      id="team-member-email"
                      type="email"
                      className={styles.teamInput}
                      placeholder="e.g. rahul@gmail.com"
                      value={newMemberEmail}
                      onChange={(e) => setNewMemberEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className={styles.teamField}>
                    <label htmlFor="team-member-role">Assigned Role</label>
                    <select
                      id="team-member-role"
                      className={styles.teamSelect}
                      value={newMemberRole}
                      onChange={(e) => setNewMemberRole(e.target.value as "reviewer" | "viewer")}
                    >
                      <option value="reviewer">Reviewer (Decide & Score)</option>
                      <option value="viewer">Viewer (Read-only)</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    className={styles.teamSubmitBtn}
                    disabled={addingMember}
                  >
                    {addingMember ? "Allowlisting..." : "+ Grant Access"}
                  </button>
                </form>
                <div className={styles.securityCallout}>
                  <span>🔒</span>
                  <span>
                    <strong>Google OAuth Protection:</strong> When the invited member clicks &quot;Sign in with Google&quot;, the system checks this allowlist. Any Google account not present here receives HTTP 403 Access Denied.
                  </span>
                </div>
              </div>

              {/* Allowlisted Users Table */}
              <div className={styles.queue}>
                <div className={styles.toolbar}>
                  <div>
                    <h2>Authorized Team Members ({teamUsers.length})</h2>
                    <p>Active reviewers and viewers with access to the CAP Admin Portal</p>
                  </div>
                </div>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>TEAM MEMBER</th>
                        <th>GOOGLE EMAIL</th>
                        <th>PORTAL ROLE</th>
                        <th>ACCESS STATUS</th>
                        <th>ADDED ON (IST)</th>
                        <th style={{ textAlign: "right" }}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingTeam && teamUsers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className={styles.empty}>
                            Loading allowlisted team members...
                          </td>
                        </tr>
                      ) : teamUsers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className={styles.empty}>
                            No team members found.
                          </td>
                        </tr>
                      ) : (
                        teamUsers.map((u) => {
                          const isSuperAdminRow = u.role === "super_admin";
                          const isSelf =
                            sessionUser?.id === u.id ||
                            sessionUser?.email?.toLowerCase() === u.email.toLowerCase();
                          return (
                            <tr key={u.id}>
                              <td>
                                <strong>{u.name}</strong>
                                {isSelf && (
                                  <small style={{ color: "#a57b2c", fontWeight: 700 }}> (Current Session)</small>
                                )}
                              </td>
                              <td>
                                <code style={{ fontSize: "11px", color: "#334155" }}>{u.email}</code>
                              </td>
                              <td>
                                {u.role === "super_admin" ? (
                                  <span className={styles.badgeRoleSuperAdmin}>Super Admin</span>
                                ) : u.role === "reviewer" ? (
                                  <span className={styles.badgeRoleReviewer}>Reviewer</span>
                                ) : (
                                  <span className={styles.badgeRoleViewer}>Viewer</span>
                                )}
                              </td>
                              <td>
                                {u.isActive ? (
                                  <span className={styles.badgeUserActive}>Active</span>
                                ) : (
                                  <span className={styles.badgeUserInactive}>Revoked</span>
                                )}
                              </td>
                              <td>{formatIST(u.createdAt)}</td>
                              <td style={{ textAlign: "right" }}>
                                {isSuperAdminRow ? (
                                  <span style={{ fontSize: "10px", color: "#94a3b8", fontStyle: "italic" }}>
                                    Protected Super Admin
                                  </span>
                                ) : (
                                  <div style={{ display: "inline-flex", gap: 6 }}>
                                    {u.isActive ? (
                                      <button
                                        type="button"
                                        className={`${styles.teamActionBtn} ${styles.teamRevokeBtn}`}
                                        onClick={() => void handleRevokeMember(u)}
                                        disabled={actingUserId === u.id}
                                        title="Revoke access immediately"
                                      >
                                        {actingUserId === u.id ? "Revoking..." : "Revoke Access"}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className={`${styles.teamActionBtn} ${styles.teamActivateBtn}`}
                                        onClick={() => void handleToggleActive(u, true)}
                                        disabled={actingUserId === u.id}
                                        title="Reactivate access"
                                      >
                                        {actingUserId === u.id ? "Updating..." : "Reactivate"}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : section === "Participants" ? (
            <ParticipantsPanel canManage={isSuperAdmin} />
          ) : section === "Task Store" ? (
            <TasksPanel canManage={isSuperAdmin} />
          ) : section === "Content" ? (
            <ContentPanel canManage={isSuperAdmin} />
          ) : section !== "Submissions" ? (
            <div className={styles.placeholder}>
              <span>◌</span>
              <h2>{section} workspace</h2>
              <p>The submissions review and leaderboard areas are connected end to end. This section remains outside the current phase.</p>
              <button onClick={() => setSection("Submissions")}>Open Submissions</button>
            </div>
          ) : (
            <>
              <div className={styles.heading}>
                <div>
                  <p className={styles.crumb}>WORKSPACE / REVIEW OPERATIONS</p>
                  <h1>Submissions review</h1>
                  <p>Review proofs, apply server-calculated penalties, and preserve every decision.</p>
                </div>
                <button className={styles.export} onClick={exportCsv}>
                  Export CSV ↓
                </button>
              </div>

              <div className={styles.metrics}>
                {[
                  ["ASSIGNED", queue?.counts.all ?? "—", "Campus Poster Challenge"],
                  ["PENDING REVIEW", queue?.counts.pending_review ?? "—", "Actionable submissions"],
                  ["LATE", queue?.counts.late ?? "—", "Penalty checked by server"],
                  ["MISSING", queue?.counts.missing ?? "—", "Past the effective deadline"],
                ].map(([label, value, caption]) => (
                  <article key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{caption}</small>
                  </article>
                ))}
              </div>

              {/* Filter chips bar */}
              <div className={styles.chips} role="tablist" aria-label="Status filters">
                {chips.map(([value, label]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={status === value}
                    className={status === value ? styles.chipActive : ""}
                    onClick={() => {
                      setStatus(value);
                      setPage(1);
                    }}
                  >
                    {label}
                    <b>{queue?.counts[value] ?? "—"}</b>
                  </button>
                ))}
              </div>

              <div className={styles.queue}>
                <div className={styles.toolbar}>
                  <div>
                    <h2>Review queue</h2>
                    <p>
                      Keyboard navigation: <kbd>j</kbd>/<kbd>k</kbd> navigate, <kbd>Enter</kbd> inspect, <kbd>o</kbd> open proof, <kbd>[</kbd>/<kbd>]</kbd> page.
                    </p>
                  </div>
                  <span>{queue?.total ?? 0} records</span>
                </div>

                <div className={styles.filters}>
                  <label className={styles.search}>
                    <span>⌕</span>
                    <input
                      ref={searchRef}
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setPage(1);
                      }}
                      placeholder="Search name, ID, roll, college… (Press / to focus)"
                      aria-label="Search submissions"
                    />
                  </label>
                  <select
                    value={taskId}
                    onChange={(event) => {
                      setTaskId(event.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter by task"
                  >
                    <option value="all">All tasks</option>
                    {queue?.filters.tasks.map((task) => (
                      <option value={task.id} key={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                  <select
                    value={reviewer}
                    onChange={(event) => {
                      setReviewer(event.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter by reviewer"
                  >
                    <option value="">All reviewers</option>
                    <option value="me">Assigned to me</option>
                    <option value="unassigned">Unassigned</option>
                    {queue?.filters.reviewers.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={college}
                    onChange={(event) => {
                      setCollege(event.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter by college"
                  >
                    <option value="">All colleges</option>
                    {queue?.filters.colleges.map((item) => (
                      <option value={item} key={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Bulk selection action bar */}
                {selectedRowKeys.length > 0 && !isViewer && !isMobile && (
                  <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
                    <span>
                      {selectedRowKeys.length} submission{selectedRowKeys.length > 1 ? "s" : ""} selected for bulk approval
                    </span>
                    <div>
                      <button disabled={acting} onClick={() => setBulkModalOpen(true)}>
                        Approve Selected ({selectedRowKeys.length})
                      </button>
                      <button className={styles.bulkCancel} onClick={() => setSelectedRowKeys([])}>
                        Clear Selection
                      </button>
                    </div>
                  </div>
                )}

                {/* Bulk results summary banner */}
                {bulkResults && (
                  <div className={styles.bulkResultsBanner} role="status">
                    <strong>
                      Bulk approval finished: {bulkResults.successCount} of {bulkResults.totalRequested} approved successfully.
                    </strong>
                    {bulkResults.failureCount > 0 && (
                      <ul className={styles.bulkFailuresList}>
                        {bulkResults.results
                          .filter((r) => !r.success)
                          .map((f) => (
                            <li key={f.id}>
                              Submission {f.id}: {f.error?.message ?? "Failed to approve"}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Notices & Errors */}
                {notice && (
                  <div className={styles.notice} role="alert">
                    <span>i</span>
                    {notice}
                    <button onClick={() => setNotice("")} aria-label="Dismiss alert">×</button>
                  </div>
                )}

                {loadError && (
                  <div className={styles.errorBanner} role="alert">
                    <span>Failed to load submissions: {loadError}</span>
                    <button className={styles.retryBtn} onClick={() => void load()}>
                      Retry
                    </button>
                  </div>
                )}

                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        {!isViewer && !isMobile && (
                          <th style={{ width: 28, textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={allCurrentPageSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const keysToAdd = selectableRows.map((r) => r.rowKey);
                                  setSelectedRowKeys((prev) => Array.from(new Set([...prev, ...keysToAdd])));
                                } else {
                                  const keysToRemove = new Set(selectableRows.map((r) => r.rowKey));
                                  setSelectedRowKeys((prev) => prev.filter((k) => !keysToRemove.has(k)));
                                }
                              }}
                              title="Select/deselect all eligible unapproved rows on this page"
                              aria-label="Select all eligible rows on this page"
                            />
                          </th>
                        )}
                        <th>PARTICIPANT</th>
                        <th>TASK</th>
                        <th>SUBMITTED (IST)</th>
                        <th>TIMING</th>
                        <th>STATUS</th>
                        <th>AWD</th>
                        <th>PEN</th>
                        <th>FINAL</th>
                        <th>REVIEWER</th>
                        <th>PROOF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className={styles.skeletonRow}>
                            {!isViewer && !isMobile && (
                              <td style={{ textAlign: "center" }}>
                                <span className={styles.skeletonCell} style={{ width: 14 }} />
                              </td>
                            )}
                            <td><span className={styles.skeletonCell} /></td>
                            <td><span className={styles.skeletonCellShort} /></td>
                            <td><span className={styles.skeletonCellShort} /></td>
                            <td><span className={styles.skeletonCellBadge} /></td>
                            <td><span className={styles.skeletonCellBadge} /></td>
                            <td><span className={styles.skeletonCell} style={{ width: 20 }} /></td>
                            <td><span className={styles.skeletonCell} style={{ width: 20 }} /></td>
                            <td><span className={styles.skeletonCell} style={{ width: 20 }} /></td>
                            <td><span className={styles.skeletonCellShort} /></td>
                            <td><span className={styles.skeletonCell} style={{ width: 40 }} /></td>
                          </tr>
                        ))
                      ) : queue?.submissions.length === 0 ? (
                        <tr>
                          <td colSpan={isViewer || isMobile ? 10 : 11}>
                            <div className={styles.emptyState}>
                              <span className={styles.emptyStateIcon}>🔍</span>
                              <strong>No submissions match these filters</strong>
                              <p>Try resetting your task, status, or search filters to find what you need.</p>
                              <button className={styles.clearFiltersBtn} onClick={clearAllFilters}>
                                Clear all filters
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        queue?.submissions.map((row, index) => {
                          const isSelected = selected?.id === row.id;
                          const isFocused = focusedRowIndex === index;
                          return (
                            <tr
                              key={row.rowKey}
                              className={`${isSelected ? styles.selectedRow : ""} ${isFocused ? styles.focusedRow : ""}`}
                              onClick={() => {
                                setFocusedRowIndex(index);
                                void open(row);
                              }}
                            >
                              {!isViewer && !isMobile && (
                                <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                                  {row.id && row.task.type !== "quiz" && row.rowStatus !== "missing" && row.rowStatus !== "approved" ? (
                                    <input
                                      type="checkbox"
                                      checked={selectedRowKeys.includes(row.rowKey)}
                                      onChange={(e) => {
                                        setSelectedRowKeys((prev) =>
                                          e.target.checked ? [...prev, row.rowKey] : prev.filter((k) => k !== row.rowKey)
                                        );
                                      }}
                                      aria-label={`Select submission for ${row.participant.name}`}
                                    />
                                  ) : null}
                                </td>
                              )}
                              <td>
                                <strong>
                                  {row.participant.name} <em>{row.participant.id}</em>
                                </strong>
                                <small>
                                  {row.participant.rollNumber} · {row.participant.college}
                                </small>
                              </td>
                              <td>
                                <strong>{row.task.title}</strong>
                                {row.task.type === "quiz" && <small className={styles.auto}>AUTO-SCORED</small>}
                                {row.task.type === "both" && <small className={styles.hybrid}>HYBRID (PROOF+QUIZ)</small>}
                              </td>
                              <td>{formatIST(row.submittedAt)}</td>
                              <td>
                                <span className={`${styles.timing} ${row.timing.isLate ? styles.late : ""}`}>
                                  {row.timing.isLate ? "◔" : "●"} {row.timing.badge}
                                </span>
                              </td>
                              <td>
                                <span className={`${styles.status} ${styles[`status_${row.rowStatus}`]}`}>
                                  {statusLabel(row.rowStatus)}
                                  {row.flags.duplicateLink && <i title="Duplicate proof link">!</i>}
                                </span>
                              </td>
                              <td>{row.pointsAwarded ?? "—"}</td>
                              <td>{row.penaltyApplied === null ? "—" : row.penaltyApplied ? `-${row.penaltyApplied}` : "0"}</td>
                              <td className={styles.final}>{row.finalPoints ?? "—"}</td>
                              <td>{row.assignedReviewer?.name ?? "Unassigned"}</td>
                              <td>
                                {row.driveLink ? (
                                  <a
                                    href={row.driveLink}
                                    onClick={(event) => event.stopPropagation()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Open ↗
                                  </a>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Submissions Table Footer with Real Pagination Controls */}
                <footer className={styles.tableFooter}>
                  <div className={styles.pagination}>
                    <span>
                      Showing {queue?.submissions.length ? (page - 1) * pageSize + 1 : 0}–
                      {Math.min(page * pageSize, queue?.total ?? 0)} of {queue?.total ?? 0} records
                    </span>
                    <div className={styles.paginationControls}>
                      <button
                        className={styles.pageBtn}
                        disabled={page <= 1 || loading}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        title="Previous page (or press [)"
                        aria-label="Previous page"
                      >
                        ← Prev
                      </button>
                      <span className={styles.pageInfo}>
                        Page {page} of {totalPages}
                      </span>
                      <button
                        className={styles.pageBtn}
                        disabled={page >= totalPages || loading}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        title="Next page (or press ])"
                        aria-label="Next page"
                      >
                        Next →
                      </button>
                      <select
                        className={styles.pageSizeSelect}
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setPage(1);
                        }}
                        aria-label="Records per page"
                      >
                        <option value={25}>25 / page</option>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                      </select>
                    </div>
                  </div>
                  <span>Server pagination · IST timestamps · immutable history</span>
                </footer>
              </div>
            </>
          )}
        </section>

        {/* Detailed Review Panel (Side-by-side on desktop, sheet on tablet, read-only on mobile) */}
        {selected && section === "Submissions" && (
          <aside className={styles.panel} role="region" aria-label="Submission Review Details">
            <div className={styles.panelHead}>
              <div>
                <span className={styles.eyebrow}>
                  {selected.rowStatus === "missing" ? "MISSING SUBMISSION" : "REVIEW PANEL"}
                </span>
                <h2>{selected.participant.name}</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <p style={{ margin: 0 }}>
                    {selected.task.title} · Version {selected.versionNo || 1}
                  </p>
                  {selected.participantStats &&
                    (selected.participantStats.duplicateFlagsCount > 0 || selected.participantStats.rejectionsCount > 0) && (
                      <span
                        style={{
                          background: "#fff1f0",
                          border: "1px solid #ffa39e",
                          color: "#cf1322",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 12,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                        title="Participant history flag counter"
                      >
                        ⚠️ {selected.participantStats.duplicateFlagsCount} duplicate flag{selected.participantStats.duplicateFlagsCount === 1 ? "" : "s"}
                        {selected.participantStats.rejectionsCount > 0 &&
                          `, ${selected.participantStats.rejectionsCount} rejection${selected.participantStats.rejectionsCount === 1 ? "" : "s"}`}
                      </span>
                    )}
                </div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close review panel">×</button>
            </div>

            <div className={styles.panelBody}>
              {/* Conflict Alert Banner */}
              {conflict && (
                <div className={styles.conflictBanner} role="alert">
                  <div className={styles.conflictHeader}>
                    <span>⚠️</span>
                    <span>Version Conflict Detected</span>
                  </div>
                  <p style={{ margin: 0 }}>
                    {conflict.message}
                    {conflict.details?.current && (
                      <span>
                        {" "}
                        (Server revision: rev{conflict.details.current.rev}, status: {conflict.details.current.rowStatus}, version: v{conflict.details.current.versionNo})
                      </span>
                    )}
                  </p>
                  <button className={styles.conflictActionBtn} onClick={() => void refreshDetail(selected.id)}>
                    Reload Latest Version
                  </button>
                </div>
              )}

              {selected.rowStatus === "missing" ? (
                <div
                  className={styles.readonly}
                  style={{ background: "#fff5f5", border: "1px solid #fed7d7", color: "#9b1c1c", marginTop: 0 }}
                >
                  <strong>Missing Submission (Read-only)</strong>
                  <p style={{ margin: "4px 0 0" }}>Participant has not submitted for this task and the deadline has passed.</p>
                </div>
              ) : (
                <a className={styles.proof} href={selected.driveLink ?? "#"} target="_blank" rel="noopener noreferrer">
                  Open proof in Drive ↗
                </a>
              )}

              {selected.flags?.duplicateLink && (
                <div
                  className={styles.notice}
                  style={{ background: "#fdf3f2", borderColor: "#f1b3b0", color: "#a8322d", margin: "10px 0 0" }}
                >
                  <span>!</span>
                  Duplicate proof link: matches submission by{" "}
                  <strong>{selected.duplicateNotice?.otherParticipantName ?? "another participant"}</strong>{" "}
                  {selected.duplicateNotice?.otherParticipantId ? `(${selected.duplicateNotice.otherParticipantId})` : ""}.
                </div>
              )}

              {selected.task.type === "both" && (
                <div
                  className={styles.notice}
                  style={{ background: "#f5f3ff", borderColor: "#ddd6fe", color: "#5b21b6", margin: "10px 0 0" }}
                >
                  <span>i</span>Hybrid task: Review proof below; quiz points are combined automatically.
                </div>
              )}

              {selected.deadlines.effectiveDeadline !== selected.task.deadline && (
                <div
                  className={styles.notice}
                  style={{ background: "#eef6ff", borderColor: "#bad5f7", color: "#1e5399", margin: "10px 0 0" }}
                >
                  <span>i</span>Deadline extended to {formatIST(selected.deadlines.effectiveDeadline)}.
                </div>
              )}

              {selected.deadlines.correctionDeadline && (
                <div
                  className={styles.notice}
                  style={{ background: "#fffbf0", borderColor: "#fae09c", color: "#8a5800", margin: "10px 0 0" }}
                >
                  <span>⏳</span>Correction window open until {formatIST(selected.deadlines.correctionDeadline)}.
                </div>
              )}

              <dl className={styles.metadata}>
                <div>
                  <dt>Submitted</dt>
                  <dd>{formatIST(selected.submittedAt)}</dd>
                </div>
                <div>
                  <dt>Timing</dt>
                  <dd>{selected.timing.label}</dd>
                </div>
                <div>
                  <dt>Max points</dt>
                  <dd>{selected.task.maxPoints}</dd>
                </div>
                <div>
                  <dt>Reviewer</dt>
                  <dd>{selected.permissions.assignedReviewerName}</dd>
                </div>
              </dl>

              <div className={styles.penalty}>
                <span>SERVER PENALTY</span>
                <strong>{selected.penaltyPoints ? `-${selected.penaltyPoints}` : "No penalty"}</strong>
                <p>{selected.penaltyExplanation}</p>
              </div>

              {selected.versions && selected.versions.length > 0 && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "9px 12px",
                    background: "#fbfcfd",
                    border: "1px solid #e5eaed",
                    borderRadius: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#788794",
                      letterSpacing: "0.08em",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    SUBMISSION VERSIONS ({selected.versions.length})
                  </span>
                  {selected.versions.map((v) => (
                    <div
                      key={v.versionNo}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 11,
                        padding: "4px 0",
                        borderBottom: "1px solid #edf1f3",
                      }}
                    >
                      <span>
                        <strong>v{v.versionNo}</strong>{" "}
                        <small style={{ color: "#89959e" }}>· {formatIST(v.submittedAt)}</small>
                      </span>
                      <a
                        href={v.driveLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#a57b2c", fontWeight: 700, textDecoration: "none" }}
                      >
                        Drive ↗
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {selected.task.type === "quiz" && (
                <div className={styles.readonly}>Auto-scored quiz: reviewer decisions are disabled.</div>
              )}

              {/* Reviewer Assignment Controls */}
              {!isViewer && selected.id && !isMobile && (
                <>
                  {selected.permissions.canClaim && (
                    <button className={styles.claim} disabled={acting} onClick={() => void claim()}>
                      Assign to me
                    </button>
                  )}
                  {selected.permissions.canRelease && (
                    <button className={styles.releaseBtn} disabled={acting} onClick={() => void release()}>
                      Release assignment (unassign)
                    </button>
                  )}
                  {selected.permissions.canReassign && (
                    <button
                      className={styles.releaseBtn}
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        setReassignReviewerId(selected.assignedReviewer?.id ?? "");
                        setReassignModalOpen(true);
                      }}
                    >
                      Reassign Reviewer…
                    </button>
                  )}
                </>
              )}

              {/* Super Admin Extensions */}
              {!isViewer && persona === "admin-s" && !isMobile && (
                <div style={{ marginTop: 10 }}>
                  {extensionMode ? (
                    <div
                      style={{
                        padding: 10,
                        background: "#f8fafb",
                        border: "1px solid #dbe2e6",
                        borderRadius: 5,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#374151",
                          display: "block",
                          marginBottom: 5,
                        }}
                      >
                        Grant Extension
                      </span>
                      <label className={styles.inputLabel} style={{ marginTop: 4 }}>
                        New Deadline
                        <input
                          type="datetime-local"
                          value={extDeadline}
                          onChange={(e) => setExtDeadline(e.target.value)}
                        />
                      </label>
                      <label className={styles.inputLabel} style={{ marginTop: 4 }}>
                        Reason
                        <textarea
                          value={extReason}
                          onChange={(e) => setExtReason(e.target.value)}
                          placeholder="Extension reason (min 5 chars)…"
                          style={{ height: 46 }}
                        />
                      </label>
                      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <button
                          className={styles.approve}
                          style={{ flex: 1, height: 30 }}
                          disabled={acting || !extDeadline || extReason.length < 5}
                          onClick={() => void submitExtension()}
                        >
                          {acting ? "Saving…" : "Save"}
                        </button>
                        <button
                          style={{
                            height: 30,
                            padding: "0 9px",
                            border: "1px solid #d1d5db",
                            borderRadius: 5,
                            background: "#fff",
                            cursor: "pointer",
                          }}
                          onClick={() => setExtensionMode(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className={styles.claim}
                      style={{ marginTop: 0 }}
                      onClick={() => setExtensionMode(true)}
                    >
                      Grant Extension (Super Admin)
                    </button>
                  )}
                </div>
              )}

              {/* Regular Review Decision */}
              {!isViewer && selected.permissions.canDecide && !isMobile && (
                <>
                  <label className={styles.inputLabel}>
                    Points awarded <span>0–{selected.task.maxPoints}</span>
                    <input
                      inputMode="numeric"
                      value={points}
                      onChange={(event) => setPoints(event.target.value.replace(/[^0-9]/g, ""))}
                      aria-label="Points awarded"
                    />
                  </label>
                  {computed ? (
                    <div className={styles.score}>
                      Final = {points} − {computed.penaltyApplied} <b>= {computed.finalPoints}</b>
                      {Number(points) < (selected.penaltyPoints ?? 0) && (
                        <small>Penalty capped at awarded points</small>
                      )}
                    </div>
                  ) : (
                    <p className={styles.error}>Enter whole points from 0 to {selected.task.maxPoints}.</p>
                  )}
                  <label className={styles.inputLabel}>
                    Feedback / reason <span>Required for reject & changes</span>
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Give the participant clear, actionable feedback…"
                      aria-label="Feedback or rejection reason"
                    />
                  </label>
                  <div className={styles.actions}>
                    <button
                      className={styles.approve}
                      disabled={acting || !computed}
                      onClick={() => void submitDecision("approved")}
                    >
                      {acting ? "Saving…" : "Approve"}
                    </button>
                    <button
                      className={styles.changes}
                      disabled={acting || reason.trim().length < 5}
                      onClick={() => void submitDecision("needs_changes")}
                      title={reason.trim().length < 5 ? "Reason of min 5 chars required" : ""}
                    >
                      Request changes
                    </button>
                    <button
                      className={styles.reject}
                      disabled={acting || reason.trim().length < 5}
                      onClick={() => void submitDecision("rejected")}
                      title={reason.trim().length < 5 ? "Reason of min 5 chars required" : ""}
                    >
                      Reject
                    </button>
                  </div>
                </>
              )}

              {/* Super Admin Decision Revision */}
              {!isViewer && selected.permissions.canRevise && !isMobile && (
                <div style={{ marginTop: 14 }}>
                  <button className={styles.reviseBtn} onClick={() => setReviseModalOpen(true)}>
                    Revise Decision (Super Admin)…
                  </button>
                </div>
              )}

              {/* Super Admin Reopen Rejected */}
              {!isViewer && selected.permissions.canReopen && !isMobile && (
                <>
                  {reopenMode && (
                    <label className={styles.inputLabel}>
                      Reason to reopen <span>Minimum 10 characters</span>
                      <textarea
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Audit reason for reopening…"
                      />
                    </label>
                  )}
                  <button
                    className={styles.reopen}
                    disabled={acting || (reopenMode && reason.trim().length < 10)}
                    onClick={() => (reopenMode ? void submitReopen() : setReopenMode(true))}
                  >
                    {reopenMode ? "Confirm reopen" : "Reopen submission"}
                  </button>
                </>
              )}

              <section className={styles.history}>
                <h3>Decision & version history</h3>
                {selected.history.map((item) => (
                  <article key={item.id}>
                    <span className={styles.historyDot} />
                    <div>
                      <p>
                        <strong>{item.actor}</strong> · {formatIST(item.at)}
                      </p>
                      <p>
                        {item.text}{" "}
                        {item.pointsAwarded !== undefined && item.pointsAwarded !== null ? (
                          <b>
                            {" "}
                            Awarded {item.pointsAwarded}; final {item.finalPoints}.
                          </b>
                        ) : null}
                      </p>
                      {item.reason && <blockquote>{item.reason}</blockquote>}
                    </div>
                  </article>
                ))}
              </section>
            </div>
          </aside>
        )}
      </div>

      {/* Bulk Approval Confirmation Modal */}
      {bulkModalOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="bulk-title">
          <div className={styles.modalBox}>
            <div className={styles.modalHead}>
              <div>
                <h3 id="bulk-title">Bulk Approve Submissions</h3>
                <p>Approve {selectedRowKeys.length} selected pending submissions in a single batch.</p>
              </div>
              <button className={styles.modalClose} onClick={() => setBulkModalOpen(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <div
                className={`${styles.radioOption} ${bulkMode === "max" ? styles.radioOptionActive : ""}`}
                onClick={() => setBulkMode("max")}
              >
                <input
                  type="radio"
                  name="bulkMode"
                  checked={bulkMode === "max"}
                  onChange={() => setBulkMode("max")}
                />
                <div className={styles.radioOptionText}>
                  <strong>Award Full Marks for each task</strong>
                  <small>Each submission is awarded its task&apos;s maximum points (e.g. 100 pts), minus server-calculated late penalties.</small>
                </div>
              </div>

              <div
                className={`${styles.radioOption} ${bulkMode === "fixed" ? styles.radioOptionActive : ""}`}
                onClick={() => setBulkMode("fixed")}
              >
                <input
                  type="radio"
                  name="bulkMode"
                  checked={bulkMode === "fixed"}
                  onChange={() => setBulkMode("fixed")}
                />
                <div className={styles.radioOptionText} style={{ flex: 1 }}>
                  <strong>Award Fixed Points to All</strong>
                  <small>Assign a specific awarded score to all selected submissions.</small>
                  {bulkMode === "fixed" && (
                    <input
                      type="number"
                      value={bulkFixedPoints}
                      onChange={(e) => setBulkFixedPoints(e.target.value)}
                      placeholder="Points (0-100)"
                      style={{ marginTop: 6, width: "100%", padding: 6, fontSize: 11 }}
                      min={0}
                      max={100}
                    />
                  )}
                </div>
              </div>

              <label className={styles.inputLabel} style={{ marginTop: 4 }}>
                Review Note (Optional)
                <textarea
                  value={bulkComment}
                  onChange={(e) => setBulkComment(e.target.value)}
                  placeholder="e.g. Batch approval of verified campus posters…"
                  style={{ height: 46 }}
                />
              </label>

              <div style={{ background: "#f8fafc", padding: 10, borderRadius: 5, fontSize: 11, color: "#475569" }}>
                <strong>Summary:</strong> Approving {selectedRowKeys.length} submissions. Server penalties will be deducted individually.
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.actionBtnSecondary} onClick={() => setBulkModalOpen(false)} disabled={acting}>
                Cancel
              </button>
              <button className={styles.actionBtnPrimary} onClick={() => void executeBulkApprove()} disabled={acting}>
                {acting ? "Approving…" : `Confirm Bulk Approval (${selectedRowKeys.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reassign Reviewer Modal */}
      {reassignModalOpen && selected && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="reassign-title">
          <div className={styles.modalBox}>
            <div className={styles.modalHead}>
              <div>
                <h3 id="reassign-title">Reassign Reviewer</h3>
                <p>
                  Submission for {selected.participant.name} ({selected.participant.id})
                </p>
              </div>
              <button className={styles.modalClose} onClick={() => setReassignModalOpen(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>
                Current assigned reviewer: <strong>{selected.permissions.assignedReviewerName}</strong>
              </p>
              <label className={styles.inputLabel}>
                Assign To
                <select
                  value={reassignReviewerId}
                  onChange={(e) => setReassignReviewerId(e.target.value)}
                  style={{ width: "100%", height: 34, marginTop: 4 }}
                >
                  <option value="">Unassigned</option>
                  {queue?.filters.reviewers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.actionBtnSecondary} onClick={() => setReassignModalOpen(false)} disabled={acting}>
                Cancel
              </button>
              <button className={styles.actionBtnPrimary} onClick={() => void submitReassign()} disabled={acting}>
                {acting ? "Reassigning…" : "Confirm Reassignment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revise Decision Modal */}
      {reviseModalOpen && selected && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="revise-title">
          <div className={styles.modalBox}>
            <div className={styles.modalHead}>
              <div>
                <h3 id="revise-title">Revise Finalized Decision (Super Admin)</h3>
                <p>
                  Revise decision for {selected.participant.name} · {selected.task.title}
                </p>
              </div>
              <button className={styles.modalClose} onClick={() => setReviseModalOpen(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>
                Current decision: <strong>{statusLabel(selected.rowStatus)}</strong> (Final points: {selected.finalPoints ?? "—"})
              </p>
              <label className={styles.inputLabel}>
                New Decision
                <select
                  value={reviseDecisionType}
                  onChange={(e) => setReviseDecisionType(e.target.value as "approved" | "needs_changes" | "rejected")}
                  style={{ width: "100%", height: 34, marginTop: 4 }}
                >
                  <option value="approved">Approved</option>
                  <option value="needs_changes">Needs changes</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>

              {reviseDecisionType === "approved" && (
                <>
                  <label className={styles.inputLabel}>
                    Points Awarded <span>0–{selected.task.maxPoints}</span>
                    <input
                      inputMode="numeric"
                      value={revisePoints}
                      onChange={(e) => setRevisePoints(e.target.value.replace(/[^0-9]/g, ""))}
                    />
                  </label>
                  {reviseComputed && (
                    <div className={styles.score} style={{ margin: "6px 0" }}>
                      Final = {revisePoints} − {reviseComputed.penaltyApplied}{" "}
                      <b>= {reviseComputed.finalPoints}</b>
                    </div>
                  )}
                </>
              )}

              <label className={styles.inputLabel}>
                Audit Reason <span>Minimum 5 characters</span>
                <textarea
                  value={reviseReason}
                  onChange={(e) => setReviseReason(e.target.value)}
                  placeholder="Detailed justification for changing previous decision…"
                  style={{ height: 50 }}
                />
              </label>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.actionBtnSecondary} onClick={() => setReviseModalOpen(false)} disabled={acting}>
                Cancel
              </button>
              <button
                className={styles.actionBtnPrimary}
                onClick={() => void submitRevise()}
                disabled={acting || reviseReason.trim().length < 5}
              >
                {acting ? "Saving…" : "Save Revised Decision"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session Expired / Re-authentication Modal */}
      {reauthOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="reauth-title">
          <div className={styles.modalBox} style={{ maxWidth: 440 }}>
            <div className={styles.modalHead}>
              <div>
                <h3 id="reauth-title">Session Expired</h3>
                <p>Your 30-minute idle review session has expired.</p>
              </div>
              <button
                className={styles.modalClose}
                onClick={() => {
                  setReauthOpen(false);
                  setPendingRetry(null);
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 28 }} role="img" aria-label="lock">🔒</span>
                <p style={{ margin: 0, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                  Please re-authenticate to continue. <strong>Your review feedback, points, and entered changes are safely preserved.</strong>
                </p>
              </div>

              {reauthError && (
                <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b", padding: "8px 12px", borderRadius: 6, fontSize: 12 }}>
                  {reauthError}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  disabled={reauthing}
                  onClick={async () => {
                    try {
                      setReauthing(true);
                      setReauthError(null);
                      await request("/api/admin/session", {
                        method: "POST",
                        body: JSON.stringify({ persona }),
                      });
                      setReauthOpen(false);
                      setNotice("Session renewed successfully.");
                      if (pendingRetry) {
                        const retry = pendingRetry;
                        setPendingRetry(null);
                        await retry();
                      }
                    } catch (err: unknown) {
                      setReauthError(err instanceof Error ? err.message : "Re-authentication failed.");
                    } finally {
                      setReauthing(false);
                    }
                  }}
                  className={styles.actionBtnPrimary}
                  style={{ width: "100%", justifyContent: "center", height: 38 }}
                >
                  {reauthing ? "Renewing session…" : `Re-authenticate as ${persona}`}
                </button>

                <a
                  href="/admin/login"
                  style={{
                    display: "block",
                    textAlign: "center",
                    fontSize: 12,
                    color: "#64748b",
                    textDecoration: "underline",
                    marginTop: 4,
                  }}
                >
                  Or sign in with Google Account →
                </a>
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button
                type="button"
                className={styles.actionBtnSecondary}
                onClick={() => {
                  setReauthOpen(false);
                  setPendingRetry(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
