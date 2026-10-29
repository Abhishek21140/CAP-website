"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@/lib/admin/types";
import type { TaskReport } from "@/lib/repositories/types";
import { request, formatDateTime, formatDateInput } from "./api-client";
import styles from "./panels.module.css";

type Props = { canManage: boolean };

const STATES = ["Draft", "Scheduled", "Live", "Closed", "Archived"] as const;

type TaskForm = {
  title: string;
  description: string;
  type: "proof_link" | "quiz" | "both";
  maxPoints: string;
  deadline: string;
  graceMinutes: string;
  penaltyRate: string;
  penaltyCap: string;
  cutoffDays: string;
  correctionWindowDays: string;
  isMandatory: boolean;
  state: string;
};

const emptyForm: TaskForm = {
  title: "",
  description: "",
  type: "proof_link",
  maxPoints: "100",
  deadline: "",
  graceMinutes: "60",
  penaltyRate: "10",
  penaltyCap: "50",
  cutoffDays: "3",
  correctionWindowDays: "3",
  isMandatory: true,
  state: "Draft",
};

const stateBadge = (state: string) =>
  state === "Live"
    ? styles.badgeLive
    : state === "Scheduled"
    ? styles.badgeScheduled
    : state === "Closed"
    ? styles.badgeClosed
    : styles.badgeDraft;

export default function TasksPanel({ canManage }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [report, setReport] = useState<TaskReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await request<{ tasks: Task[] }>("/api/admin/tasks");
      setTasks(result.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openCreate = () => {
    setForm(emptyForm);
    setCreating(true);
    setEditing(null);
  };

  const openEdit = (task: Task) => {
    setForm({
      title: task.title,
      description: task.description ?? "",
      type: task.type,
      maxPoints: String(task.maxPoints),
      deadline: formatDateInput(task.deadline),
      graceMinutes: String(task.graceMinutes),
      penaltyRate: String(task.penaltyRate),
      penaltyCap: String(task.penaltyCap),
      cutoffDays: String(task.cutoffDays),
      correctionWindowDays: String(task.correctionWindowDays),
      isMandatory: task.isMandatory ?? true,
      state: task.state ?? "Draft",
    });
    setEditing(task);
    setCreating(false);
  };

  const closeModal = () => {
    setEditing(null);
    setCreating(false);
    setSaving(false);
  };

  const toPayload = () => ({
    title: form.title,
    description: form.description,
    type: form.type,
    maxPoints: Number(form.maxPoints),
    deadline: form.deadline ? new Date(form.deadline).toISOString() : "",
    graceMinutes: Number(form.graceMinutes),
    penaltyRate: Number(form.penaltyRate),
    penaltyCap: Number(form.penaltyCap),
    cutoffDays: Number(form.cutoffDays),
    correctionWindowDays: Number(form.correctionWindowDays),
    isMandatory: form.isMandatory,
    state: form.state,
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        await request("/api/admin/tasks", { method: "POST", body: JSON.stringify(toPayload()) });
        setNotice(`Created task "${form.title}".`);
      } else if (editing) {
        await request(`/api/admin/tasks/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload()),
        });
        setNotice(`Updated "${form.title}".`);
      }
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save task.");
    } finally {
      setSaving(false);
    }
  };

  const changeState = async (task: Task, state: string) => {
    setError(null);
    try {
      await request(`/api/admin/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ state }) });
      setNotice(`"${task.title}" is now ${state}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change task state.");
    }
  };

  const duplicate = async (task: Task) => {
    setError(null);
    try {
      const result = await request<{ task: Task }>(`/api/admin/tasks/${task.id}/duplicate`, { method: "POST" });
      setNotice(`Duplicated as "${result.task.title}".`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to duplicate task.");
    }
  };

  const openReport = async (task: Task) => {
    setReportLoading(true);
    setReport(null);
    setError(null);
    try {
      const result = await request<TaskReport>(`/api/admin/tasks/${task.id}/report`);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load task report.");
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>Task Store</h2>
            <p>Create, publish and close tasks. Changes apply to new submissions only.</p>
          </div>
          {canManage && (
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openCreate}>
              + New task
            </button>
          )}
        </div>

        {error && <div className={styles.error} style={{ margin: "12px 17px" }}>{error}</div>}
        {notice && <div className={styles.notice} style={{ margin: "12px 17px" }}>{notice}</div>}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Task</th>
                <th>Type</th>
                <th>State</th>
                <th>Deadline</th>
                <th>Max points</th>
                <th>Assigned</th>
                <th>Penalty</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className={styles.tableEmpty} colSpan={8}>
                    Loading tasks…
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td className={styles.tableEmpty} colSpan={8}>
                    No tasks yet. Create the first one.
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.title}</strong>
                      <small>{task.id}</small>
                    </td>
                    <td>{task.type === "both" ? "Proof + quiz" : task.type === "quiz" ? "Quiz" : "Proof link"}</td>
                    <td>
                      <span className={`${styles.badge} ${stateBadge(task.state ?? "Draft")}`}>{task.state ?? "Draft"}</span>
                    </td>
                    <td>{formatDateTime(task.deadline)}</td>
                    <td>{task.maxPoints}</td>
                    <td>{task.assignedCount ?? "—"}</td>
                    <td>
                      {task.penaltyRate}% / day · cap {task.penaltyCap}%
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => void openReport(task)}>
                          Report
                        </button>
                        {canManage && (
                          <>
                            <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => openEdit(task)}>
                              Edit
                            </button>
                            <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => void duplicate(task)}>
                              Duplicate
                            </button>
                            {task.state !== "Live" && task.state !== "Closed" && (
                              <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => void changeState(task, "Live")}>
                                Publish
                              </button>
                            )}
                            {task.state === "Live" && (
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnSmall} ${styles.btnDanger}`}
                                onClick={() => void changeState(task, "Closed")}
                              >
                                Close
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || editing) && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div>
                <h3>{creating ? "Create task" : `Edit ${editing?.title}`}</h3>
                <p>Penalty rules are snapshotted per submission when it is first received.</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label>Title</label>
                <input className={styles.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label>Description</label>
                <textarea
                  className={styles.textarea}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className={styles.grid}>
                <div className={styles.field}>
                  <label>Type</label>
                  <select
                    className={styles.select}
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as TaskForm["type"] })}
                  >
                    <option value="proof_link">Proof link</option>
                    <option value="quiz">Quiz</option>
                    <option value="both">Proof + quiz</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label>State</label>
                  <select className={styles.select} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                    {STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Max points</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={form.maxPoints}
                    onChange={(e) => setForm({ ...form, maxPoints: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label>Deadline (your local time)</label>
                  <input
                    type="datetime-local"
                    className={styles.input}
                    value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label>Grace (minutes)</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={form.graceMinutes}
                    onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label>Penalty rate (% / day)</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={form.penaltyRate}
                    onChange={(e) => setForm({ ...form, penaltyRate: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label>Penalty cap (%)</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={form.penaltyCap}
                    onChange={(e) => setForm({ ...form, penaltyCap: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label>Cutoff (days)</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={form.cutoffDays}
                    onChange={(e) => setForm({ ...form, cutoffDays: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label>Correction window (days)</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={form.correctionWindowDays}
                    onChange={(e) => setForm({ ...form, correctionWindowDays: e.target.value })}
                  />
                </div>
              </div>
              <label className={styles.hint} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={form.isMandatory} onChange={(e) => setForm({ ...form, isMandatory: e.target.checked })} />
                Mandatory task
              </label>
            </div>
            <div className={styles.modalFoot}>
              <button type="button" className={styles.btn} onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : creating ? "Create task" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {(report || reportLoading) && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal} style={{ width: "min(900px, 96vw)" }}>
            <div className={styles.modalHead}>
              <div>
                <h3>{report ? report.taskTitle : "Task report"}</h3>
                <p>Eight PRD status counts plus participant drill-down.</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setReport(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {reportLoading || !report ? (
                <p className={styles.hint}>Loading report…</p>
              ) : (
                <>
                  <div className={styles.metrics}>
                    <div className={styles.metric}>
                      <span>Assigned</span>
                      <strong>{report.counts.assigned}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>On time</span>
                      <strong>{report.counts.onTime}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>Late</span>
                      <strong>{report.counts.late}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>Pending review</span>
                      <strong>{report.counts.pendingReview}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>Approved</span>
                      <strong>{report.counts.approved}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>Needs changes</span>
                      <strong>{report.counts.needsChanges}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>Rejected</span>
                      <strong>{report.counts.rejected}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>Missing</span>
                      <strong>{report.counts.missing}</strong>
                    </div>
                  </div>

                  <div className={styles.tableWrap} style={{ maxHeight: 340 }}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Participant</th>
                          <th>College</th>
                          <th>Status</th>
                          <th>Submitted</th>
                          <th>Points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.participants.length === 0 ? (
                          <tr>
                            <td className={styles.tableEmpty} colSpan={5}>
                              No assignments for this task.
                            </td>
                          </tr>
                        ) : (
                          report.participants.map((row) => (
                            <tr key={row.rowKey}>
                              <td>
                                <strong>{row.participant.name}</strong>
                                <small>{row.participant.rollNumber}</small>
                              </td>
                              <td>{row.participant.college}</td>
                              <td>{row.rowStatus.replace(/_/g, " ")}</td>
                              <td>{row.submittedAt ? formatDateTime(row.submittedAt) : "—"}</td>
                              <td>{row.finalPoints ?? "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            <div className={styles.modalFoot}>
              {report && (
                <a
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                  href={`/api/admin/tasks/${report.taskId}/report/export`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Export CSV ↓
                </a>
              )}
              <button type="button" className={styles.btn} onClick={() => setReport(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
