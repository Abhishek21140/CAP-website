"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ListParticipantsResult, ParticipantDetail } from "@/lib/repositories/types";
import { request, parseCsv } from "./api-client";
import styles from "./panels.module.css";

type Props = { canManage: boolean };

const STATUSES = ["Pending Approval", "Active", "Inactive"] as const;

const statusBadge = (status: string) =>
  status === "Active" ? styles.badgeActive : status === "Pending Approval" ? styles.badgePending : styles.badgeInactive;

type ParticipantForm = {
  name: string;
  email: string;
  phone: string;
  college: string;
  branch: string;
  year: string;
  city: string;
  rollNumber: string;
  status: string;
};

const emptyForm: ParticipantForm = {
  name: "",
  email: "",
  phone: "",
  college: "",
  branch: "",
  year: "",
  city: "",
  rollNumber: "",
  status: "Active" as string,
};

export default function ParticipantsPanel({ canManage }: Props) {
  const [data, setData] = useState<ListParticipantsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [college, setCollege] = useState("");
  const [status, setStatus] = useState("");
  const [year, setYear] = useState("");
  const [sortField, setSortField] = useState("rank");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ParticipantDetail | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ParticipantForm[]>([]);
  const [importPreview, setImportPreview] = useState<{ totalRows: number; valid: number; duplicates: number; errors: { row: number; message: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (college) params.set("college", college);
      if (status) params.set("status", status);
      if (year) params.set("year", year);
      if (sortField) params.set("sortField", sortField);
      params.set("sortOrder", sortOrder);
      if (includeDeleted) params.set("includeDeleted", "true");

      const result = await request<ListParticipantsResult>(`/api/admin/participants?${params.toString()}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load participants.");
    } finally {
      setLoading(false);
    }
  }, [page, search, college, status, year, sortField, sortOrder, includeDeleted]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const resetView = () => {
    setPage(1);
    setSelected(new Set());
  };

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? pageSize))),
    [data, pageSize]
  );

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreate = () => {
    setForm(emptyForm);
    setCreating(true);
    setEditing(null);
  };

  const openEdit = (participant: ParticipantDetail) => {
    setForm({
      name: participant.name,
      email: participant.email,
      phone: participant.phone ?? "",
      college: participant.college,
      branch: participant.branch ?? "",
      year: participant.year ?? "",
      city: participant.city ?? "",
      rollNumber: participant.rollNumber,
      status: participant.status,
    });
    setEditing(participant);
    setCreating(false);
  };

  const closeModal = () => {
    setEditing(null);
    setCreating(false);
    setSaving(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        await request("/api/admin/participants", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            phone: form.phone || undefined,
            college: form.college,
            branch: form.branch || undefined,
            year: form.year || undefined,
            city: form.city || undefined,
            rollNumber: form.rollNumber,
            termsAccepted: true,
          }),
        });
        setNotice(`Added ${form.name}.`);
      } else if (editing) {
        await request(`/api/admin/participants/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name,
            phone: form.phone || null,
            college: form.college,
            branch: form.branch || null,
            year: form.year || null,
            city: form.city || null,
            rollNumber: form.rollNumber,
            status: form.status,
          }),
        });
        setNotice(`Updated ${form.name}.`);
      }
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save participant.");
    } finally {
      setSaving(false);
    }
  };

  const bulkStatus = async (nextStatus: string) => {
    if (selected.size === 0) return;
    setError(null);
    try {
      const result = await request<{ updatedCount: number }>("/api/admin/participants/bulk-status", {
        method: "POST",
        body: JSON.stringify({ ids: Array.from(selected), status: nextStatus }),
      });
      setNotice(`${result.updatedCount} participant(s) set to ${nextStatus}.`);
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk update failed.");
    }
  };

  const remove = async (participant: ParticipantDetail) => {
    if (!window.confirm(`Soft-delete ${participant.name}? They will be removed from the leaderboard.`)) return;
    setError(null);
    try {
      await request(`/api/admin/participants/${participant.id}`, { method: "DELETE" });
      setNotice(`${participant.name} moved to deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete participant.");
    }
  };

  const restore = async (participant: ParticipantDetail) => {
    setError(null);
    try {
      await request(`/api/admin/participants/${participant.id}/restore`, { method: "POST" });
      setNotice(`${participant.name} restored.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to restore participant.");
    }
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (college) params.set("college", college);
    if (status) params.set("status", status);
    window.open(`/api/admin/participants/export?${params.toString()}`, "_blank");
  };

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");

      const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
      const indexOf = (...names: string[]) => header.findIndex((h) => names.includes(h));

      const nameIdx = indexOf("name", "fullname");
      const emailIdx = indexOf("email", "emailaddress");
      const phoneIdx = indexOf("phone", "phonenumber", "mobile");
      const collegeIdx = indexOf("college", "institution");
      const branchIdx = indexOf("branch", "department");
      const yearIdx = indexOf("year", "studyyear");
      const cityIdx = indexOf("city");
      const rollIdx = indexOf("rollnumber", "rollno", "roll");

      if (nameIdx < 0 || emailIdx < 0 || collegeIdx < 0 || rollIdx < 0) {
        throw new Error("CSV must include name, email, college and roll number columns.");
      }

      const parsed = rows.slice(1).map((row) => ({
        name: row[nameIdx]?.trim() ?? "",
        email: row[emailIdx]?.trim() ?? "",
        phone: phoneIdx >= 0 ? row[phoneIdx]?.trim() ?? "" : "",
        college: collegeIdx >= 0 ? row[collegeIdx]?.trim() ?? "" : "",
        branch: branchIdx >= 0 ? row[branchIdx]?.trim() ?? "" : "",
        year: yearIdx >= 0 ? row[yearIdx]?.trim() ?? "" : "",
        city: cityIdx >= 0 ? row[cityIdx]?.trim() ?? "" : "",
        rollNumber: rollIdx >= 0 ? row[rollIdx]?.trim() ?? "" : "",
        status: "Active",
      }));

      setImportRows(parsed);
      setImportOpen(true);
      setImportPreview(null);
      const preview = await request<{ totalRows: number; valid: number; duplicates: number; errors: { row: number; message: string }[] }>(
        "/api/admin/participants/import",
        { method: "POST", body: JSON.stringify({ rows: parsed, preview: true }) }
      );
      setImportPreview(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to read CSV file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmImport = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await request<{ created: number; skipped: number; errors: { message: string }[] }>(
        "/api/admin/participants/import",
        { method: "POST", body: JSON.stringify({ rows: importRows, preview: false }) }
      );
      setNotice(`Imported ${result.created} participant(s); skipped ${result.skipped}.`);
      setImportOpen(false);
      setImportRows([]);
      setImportPreview(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>Participants</h2>
            <p>Search, filter, edit and manage every CAP participant.</p>
          </div>
          <div className={styles.rowActions}>
            <button type="button" className={styles.btn} onClick={exportCsv}>
              Export CSV ↓
            </button>
            {canManage && (
              <>
                <button type="button" className={styles.btn} onClick={() => fileRef.current?.click()}>
                  Import CSV
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openCreate}>
                  + Add participant
                </button>
              </>
            )}
          </div>
        </div>

        <div className={styles.toolbar}>
          <input
            className={`${styles.input} ${styles.search}`}
            placeholder="Search name, email, roll number, college, phone…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetView();
            }}
          />
          <select
            className={styles.select}
            value={college}
            onChange={(event) => {
              setCollege(event.target.value);
              resetView();
            }}
          >
            <option value="">All colleges</option>
            {data?.filters.colleges.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              resetView();
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
              resetView();
            }}
          >
            <option value="">All years</option>
            {data?.filters.years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={sortField}
            onChange={(event) => {
              setSortField(event.target.value);
              resetView();
            }}
          >
            <option value="rank">Sort: Rank</option>
            <option value="totalPoints">Sort: Points</option>
            <option value="tasksCompleted">Sort: Tasks completed</option>
            <option value="lateCount">Sort: Late count</option>
            <option value="name">Sort: Name</option>
            <option value="college">Sort: College</option>
            <option value="createdAt">Sort: Registered</option>
          </select>
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              setSortOrder((current) => (current === "asc" ? "desc" : "asc"));
              resetView();
            }}
            title="Toggle sort direction"
          >
            {sortOrder === "asc" ? "Asc ↑" : "Desc ↓"}
          </button>
          <label className={styles.hint} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(event) => {
                setIncludeDeleted(event.target.checked);
                resetView();
              }}
            />
            Show deleted
          </label>
        </div>

        {selected.size > 0 && canManage && (
          <div className={styles.toolbar} style={{ background: "#fbf5e9" }}>
            <strong style={{ fontSize: 11 }}>{selected.size} selected</strong>
            {STATUSES.map((item) => (
              <button key={item} type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => void bulkStatus(item)}>
                Set {item}
              </button>
            ))}
            <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {error && <div className={styles.error} style={{ margin: "12px 17px" }}>{error}</div>}
        {notice && <div className={styles.notice} style={{ margin: "12px 17px" }}>{notice}</div>}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {canManage && <th style={{ width: 30 }} />}
                <th>ID</th>
                <th>Participant</th>
                <th>College</th>
                <th>Year</th>
                <th>Status</th>
                <th>Points</th>
                <th>Tasks</th>
                <th>Late</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className={styles.tableEmpty} colSpan={canManage ? 10 : 9}>
                    Loading participants…
                  </td>
                </tr>
              ) : !data || data.participants.length === 0 ? (
                <tr>
                  <td className={styles.tableEmpty} colSpan={canManage ? 10 : 9}>
                    No participants match these filters.
                  </td>
                </tr>
              ) : (
                data.participants.map((participant) => (
                  <tr key={participant.id}>
                    {canManage && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(participant.id)}
                          onChange={() => toggleSelected(participant.id)}
                          aria-label={`Select ${participant.name}`}
                        />
                      </td>
                    )}
                    <td>{participant.id}</td>
                    <td>
                      <strong>{participant.name}</strong>
                      <small>{participant.email}</small>
                      <small>{participant.rollNumber}</small>
                    </td>
                    <td>{participant.college}</td>
                    <td>{participant.year ?? "—"}</td>
                    <td>
                      <span className={`${styles.badge} ${statusBadge(participant.status)}`}>{participant.status}</span>
                      {participant.deletedAt && <small style={{ color: "#b7524c" }}>deleted</small>}
                    </td>
                    <td>{participant.totalPoints}</td>
                    <td>{participant.tasksCompleted}</td>
                    <td>{participant.lateCount}</td>
                    <td>
                      <div className={styles.rowActions}>
                        {canManage && (
                          <>
                            <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => openEdit(participant)}>
                              Edit
                            </button>
                            {participant.deletedAt ? (
                              <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => void restore(participant)}>
                                Restore
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnSmall} ${styles.btnDanger}`}
                                onClick={() => void remove(participant)}
                              >
                                Delete
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

        <div className={styles.pagination}>
          <span>
            {data ? `${data.total} participant(s) · page ${data.page} of ${totalPages}` : "—"}
          </span>
          <div className={styles.rowActions}>
            <button type="button" className={`${styles.btn} ${styles.btnSmall}`} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ← Prev
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnSmall}`} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {(creating || editing) && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div>
                <h3>{creating ? "Add participant" : `Edit ${editing?.name}`}</h3>
                <p>Changes are written to the audit log.</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.grid}>
                <div className={styles.field}>
                  <label>Name</label>
                  <input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label>Email</label>
                  <input
                    className={styles.input}
                    value={form.email}
                    disabled={!creating}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label>Phone</label>
                  <input className={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label>College</label>
                  <input className={styles.input} value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label>Branch</label>
                  <input className={styles.input} value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label>Year</label>
                  <input className={styles.input} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label>City</label>
                  <input className={styles.input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label>Roll number</label>
                  <input className={styles.input} value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} />
                </div>
                {!creating && (
                  <div className={styles.field}>
                    <label>Status</label>
                    <select className={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      {STATUSES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button type="button" className={styles.btn} onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : creating ? "Create participant" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div>
                <h3>Import participants from CSV</h3>
                <p>Preview runs validation without writing anything.</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setImportOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {importPreview ? (
                <>
                  <div className={styles.metrics}>
                    <div className={styles.metric}>
                      <span>Rows</span>
                      <strong>{importPreview.totalRows}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>Ready</span>
                      <strong>{importPreview.valid}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>Duplicates</span>
                      <strong>{importPreview.duplicates}</strong>
                    </div>
                    <div className={styles.metric}>
                      <span>Errors</span>
                      <strong>{importPreview.errors.length}</strong>
                    </div>
                  </div>
                  {importPreview.errors.length > 0 && (
                    <div className={styles.error}>
                      {importPreview.errors.slice(0, 8).map((item) => (
                        <div key={`${item.row}-${item.message}`}>
                          Row {item.row}: {item.message}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className={styles.hint}>Validating…</p>
              )}
            </div>
            <div className={styles.modalFoot}>
              <button type="button" className={styles.btn} onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={saving || !importPreview || importPreview.valid === 0}
                onClick={() => void confirmImport()}
              >
                {saving ? "Importing…" : `Import ${importPreview?.valid ?? 0} row(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
