"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AnnouncementItem,
  BenefitItem,
  FaqItem,
  MilestoneItem,
  ProgramInfoItem,
  TestimonialItem,
} from "@/lib/repositories/types";
import { request, formatDateTime } from "./api-client";
import styles from "./panels.module.css";

type Props = { canManage: boolean };

type Tab = "faqs" | "benefits" | "program-info" | "milestones" | "testimonials" | "announcements";

const TABS: { id: Tab; label: string }[] = [
  { id: "faqs", label: "FAQs" },
  { id: "benefits", label: "Benefits" },
  { id: "program-info", label: "Program Info" },
  { id: "milestones", label: "Milestones" },
  { id: "testimonials", label: "Testimonials" },
  { id: "announcements", label: "Announcements" },
];

const STATUS_BADGE: Record<string, string> = {
  published: styles.badgePublished,
  draft: styles.badgeDraft,
  hidden: styles.badgeHidden,
  archived: styles.badgeArchived,
  confirmed: styles.badgePublished,
  placeholder: styles.badgeDraft,
  granted: styles.badgePublished,
  withdrawn: styles.badgeDanger,
};

type ContentForm = {
  group: string;
  question: string;
  answer: string;
  title: string;
  description: string;
  icon: string;
  tier: string;
  label: string;
  phase: string;
  startDate: string;
  endDate: string;
  isPeak: boolean;
  participantName: string;
  quote: string;
  college: string;
  year: string;
  roleOrCohort: string;
  sourceLabel: string;
  photoUrl: string;
  verifiedAchievement: string;
  consentStatus: string;
  body: string;
  publishFrom: string;
  publishTo: string;
  displayOrder: string;
  status: string;
  requiresConfirmation: boolean;
};

const emptyForm: ContentForm = {
  group: "about",
  question: "",
  answer: "",
  title: "",
  description: "",
  icon: "star",
  tier: "experience",
  label: "",
  phase: "",
  startDate: "",
  endDate: "",
  isPeak: false,
  participantName: "",
  quote: "",
  college: "",
  year: "",
  roleOrCohort: "",
  sourceLabel: "alumni",
  photoUrl: "",
  verifiedAchievement: "",
  consentStatus: "granted",
  body: "",
  publishFrom: "",
  publishTo: "",
  displayOrder: "0",
  status: "draft",
  requiresConfirmation: false,
};

const toDateInput = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toIso = (value: string) => (value ? new Date(value).toISOString() : null);

export default function ContentPanel({ canManage }: Props) {
  const [tab, setTab] = useState<Tab>("faqs");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [benefits, setBenefits] = useState<BenefitItem[]>([]);
  const [milestones, setMilestones] = useState<MilestoneItem[]>([]);
  const [testimonials, setTestimonials] = useState<TestimonialItem[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [programEdits, setProgramEdits] = useState<Record<string, { value: string; status: "confirmed" | "placeholder" }>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ContentForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "faqs") {
        const result = await request<{ faqs: FaqItem[] }>("/api/admin/content/faqs");
        setFaqs(result.faqs);
      } else if (tab === "benefits") {
        const result = await request<{ benefits: BenefitItem[] }>("/api/admin/content/benefits");
        setBenefits(result.benefits);
      } else if (tab === "milestones") {
        const result = await request<{ milestones: MilestoneItem[] }>("/api/admin/content/milestones");
        setMilestones(result.milestones);
      } else if (tab === "testimonials") {
        const result = await request<{ testimonials: TestimonialItem[] }>("/api/admin/content/testimonials");
        setTestimonials(result.testimonials);
      } else if (tab === "announcements") {
        const result = await request<{ announcements: AnnouncementItem[] }>("/api/admin/content/announcements");
        setAnnouncements(result.announcements);
      } else {
        const result = await request<{ programInfo: Record<string, ProgramInfoItem> }>("/api/admin/content/program-info");
        const edits: Record<string, { value: string; status: "confirmed" | "placeholder" }> = {};
        Object.values(result.programInfo).forEach((item) => {
          edits[item.key] = { value: item.value, status: item.status };
        });
        setProgramEdits(edits);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load content.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openCreate = () => {
    setForm({ ...emptyForm, status: tab === "announcements" ? "draft" : "draft" });
    setCreating(true);
    setEditingId(null);
  };

  const openEdit = (item: FaqItem | BenefitItem | MilestoneItem | TestimonialItem | AnnouncementItem) => {
    const next = { ...emptyForm };
    if (tab === "faqs") {
      const faq = item as FaqItem;
      Object.assign(next, {
        group: faq.group,
        question: faq.question,
        answer: faq.answer,
        displayOrder: String(faq.displayOrder),
        status: faq.status,
        requiresConfirmation: faq.requiresConfirmation,
      });
    } else if (tab === "benefits") {
      const benefit = item as BenefitItem;
      Object.assign(next, {
        title: benefit.title,
        description: benefit.description,
        icon: benefit.icon,
        tier: benefit.tier,
        displayOrder: String(benefit.displayOrder),
        status: benefit.status,
        requiresConfirmation: benefit.requiresConfirmation,
      });
    } else if (tab === "milestones") {
      const milestone = item as MilestoneItem;
      Object.assign(next, {
        label: milestone.label,
        phase: milestone.phase,
        startDate: toDateInput(milestone.startDate),
        endDate: toDateInput(milestone.endDate),
        isPeak: milestone.isPeak,
        displayOrder: String(milestone.displayOrder),
        status: milestone.status,
      });
    } else if (tab === "testimonials") {
      const testimonial = item as TestimonialItem;
      Object.assign(next, {
        participantName: testimonial.participantName,
        quote: testimonial.quote,
        college: testimonial.college ?? "",
        year: testimonial.year ?? "",
        roleOrCohort: testimonial.roleOrCohort ?? "",
        sourceLabel: testimonial.sourceLabel,
        photoUrl: testimonial.photoUrl ?? "",
        verifiedAchievement: testimonial.verifiedAchievement ?? "",
        consentStatus: testimonial.consentStatus,
        displayOrder: String(testimonial.displayOrder),
        status: testimonial.status,
      });
    } else {
      const announcement = item as AnnouncementItem;
      Object.assign(next, {
        title: announcement.title,
        body: announcement.body,
        status: announcement.status,
        publishFrom: toDateInput(announcement.publishFrom),
        publishTo: toDateInput(announcement.publishTo),
      });
    }
    setForm(next);
    setEditingId(item.id);
    setCreating(false);
  };

  const closeModal = () => {
    setEditingId(null);
    setCreating(false);
    setSaving(false);
  };

  const buildPayload = () => {
    const displayOrder = Number(form.displayOrder) || 0;
    switch (tab) {
      case "faqs":
        return {
          group: form.group,
          question: form.question,
          answer: form.answer,
          displayOrder,
          status: form.status,
          requiresConfirmation: form.requiresConfirmation,
        };
      case "benefits":
        return {
          title: form.title,
          description: form.description,
          icon: form.icon,
          tier: form.tier,
          displayOrder,
          status: form.status,
          requiresConfirmation: form.requiresConfirmation,
        };
      case "milestones":
        return {
          label: form.label,
          phase: form.phase,
          startDate: toIso(form.startDate),
          endDate: toIso(form.endDate),
          isPeak: form.isPeak,
          displayOrder,
          status: form.status,
        };
      case "testimonials":
        return {
          participantName: form.participantName,
          photoUrl: form.photoUrl || null,
          college: form.college || null,
          year: form.year || null,
          roleOrCohort: form.roleOrCohort || null,
          sourceLabel: form.sourceLabel,
          quote: form.quote,
          verifiedAchievement: form.verifiedAchievement || null,
          consentStatus: form.consentStatus,
          displayOrder,
          status: form.status,
        };
      default:
        return {
          title: form.title,
          body: form.body,
          status: form.status,
          publishFrom: toIso(form.publishFrom),
          publishTo: toIso(form.publishTo),
        };
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const base = `/api/admin/content/${tab}`;
      if (creating) {
        await request(base, { method: "POST", body: JSON.stringify(buildPayload()) });
        setNotice("Content created.");
      } else if (editingId) {
        await request(`${base}/${editingId}`, { method: "PATCH", body: JSON.stringify(buildPayload()) });
        setNotice("Content updated.");
      }
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save content.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await request(`/api/admin/content/${tab}/${id}`, { method: "DELETE" });
      setNotice("Content deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete content.");
    }
  };

  const quickStatus = async (id: string, status: string) => {
    setError(null);
    try {
      await request(`/api/admin/content/${tab}/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update status.");
    }
  };

  const saveProgramInfo = async (key: string) => {
    const edit = programEdits[key];
    if (!edit) return;
    setError(null);
    try {
      await request("/api/admin/content/program-info", {
        method: "PATCH",
        body: JSON.stringify({ key, value: edit.value, status: edit.status }),
      });
      setNotice(`${key} saved.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save program info.");
    }
  };

  const labelFor = (item: FaqItem | BenefitItem | MilestoneItem | TestimonialItem | AnnouncementItem) => {
    if (tab === "faqs") return (item as FaqItem).question;
    if (tab === "benefits") return (item as BenefitItem).title;
    if (tab === "milestones") return (item as MilestoneItem).label;
    if (tab === "testimonials") return (item as TestimonialItem).participantName;
    return (item as AnnouncementItem).title;
  };

  const hideStatus = tab === "announcements" ? "archived" : "hidden";

  const renderActions = (item: FaqItem | BenefitItem | MilestoneItem | TestimonialItem | AnnouncementItem) => (
    <div className={styles.rowActions}>
      <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => openEdit(item)}>
        Edit
      </button>
      {canManage && item.status !== "published" && (
        <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => void quickStatus(item.id, "published")}>
          Publish
        </button>
      )}
      {canManage && item.status === "published" && (
        <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => void quickStatus(item.id, hideStatus)}>
          Hide
        </button>
      )}
      {canManage && (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSmall} ${styles.btnDanger}`}
          onClick={() => void remove(item.id, labelFor(item))}
        >
          Delete
        </button>
      )}
    </div>
  );

  const statusBadge = (status: string) => (
    <span className={`${styles.badge} ${STATUS_BADGE[status] ?? styles.badgeDraft}`}>{status}</span>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>Content</h2>
            <p>No-code CMS. Only published items appear on the public site.</p>
          </div>
          {canManage && tab !== "program-info" && (
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openCreate}>
              + New {tab === "faqs" ? "FAQ" : tab === "benefits" ? "benefit" : tab === "milestones" ? "milestone" : tab === "testimonials" ? "testimonial" : "announcement"}
            </button>
          )}
        </div>

        <div className={styles.tabs} role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error && <div className={styles.error} style={{ margin: "12px 17px" }}>{error}</div>}
        {notice && <div className={styles.notice} style={{ margin: "12px 17px" }}>{notice}</div>}

        <div className={styles.tableWrap} style={{ marginTop: 12 }}>
          {loading ? (
            <div className={styles.empty}>Loading content…</div>
          ) : tab === "faqs" ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Group</th>
                  <th>Status</th>
                  <th>Order</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {faqs.length === 0 ? (
                  <tr>
                    <td className={styles.tableEmpty} colSpan={5}>
                      No FAQs yet.
                    </td>
                  </tr>
                ) : (
                  faqs.map((faq) => (
                    <tr key={faq.id}>
                      <td>
                        <strong>{faq.question}</strong>
                        {faq.requiresConfirmation && <small>Needs confirmation</small>}
                      </td>
                      <td>{faq.group}</td>
                      <td>{statusBadge(faq.status)}</td>
                      <td>{faq.displayOrder}</td>
                      <td>{renderActions(faq)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : tab === "benefits" ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Tier</th>
                  <th>Status</th>
                  <th>Order</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {benefits.length === 0 ? (
                  <tr>
                    <td className={styles.tableEmpty} colSpan={5}>
                      No benefits yet.
                    </td>
                  </tr>
                ) : (
                  benefits.map((benefit) => (
                    <tr key={benefit.id}>
                      <td>
                        <strong>{benefit.title}</strong>
                        <small>{benefit.description}</small>
                      </td>
                      <td>{benefit.tier}</td>
                      <td>{statusBadge(benefit.status)}</td>
                      <td>{benefit.displayOrder}</td>
                      <td>{renderActions(benefit)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : tab === "milestones" ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Phase</th>
                  <th>Peak</th>
                  <th>Status</th>
                  <th>Order</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {milestones.length === 0 ? (
                  <tr>
                    <td className={styles.tableEmpty} colSpan={6}>
                      No milestones yet.
                    </td>
                  </tr>
                ) : (
                  milestones.map((milestone) => (
                    <tr key={milestone.id}>
                      <td>
                        <strong>{milestone.label}</strong>
                        <small>
                          {milestone.startDate ? formatDateTime(milestone.startDate) : "—"} →{" "}
                          {milestone.endDate ? formatDateTime(milestone.endDate) : "—"}
                        </small>
                      </td>
                      <td>{milestone.phase}</td>
                      <td>{milestone.isPeak ? "Yes" : "No"}</td>
                      <td>{statusBadge(milestone.status)}</td>
                      <td>{milestone.displayOrder}</td>
                      <td>{renderActions(milestone)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : tab === "testimonials" ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Source</th>
                  <th>Consent</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {testimonials.length === 0 ? (
                  <tr>
                    <td className={styles.tableEmpty} colSpan={5}>
                      No testimonials yet. Testimonials need recorded consent before publishing.
                    </td>
                  </tr>
                ) : (
                  testimonials.map((testimonial) => (
                    <tr key={testimonial.id}>
                      <td>
                        <strong>{testimonial.participantName}</strong>
                        <small>{testimonial.quote}</small>
                      </td>
                      <td>{testimonial.sourceLabel.replace(/_/g, " ")}</td>
                      <td>{statusBadge(testimonial.consentStatus)}</td>
                      <td>{statusBadge(testimonial.status)}</td>
                      <td>{renderActions(testimonial)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : tab === "announcements" ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Publish window</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {announcements.length === 0 ? (
                  <tr>
                    <td className={styles.tableEmpty} colSpan={4}>
                      No announcements yet.
                    </td>
                  </tr>
                ) : (
                  announcements.map((announcement) => (
                    <tr key={announcement.id}>
                      <td>
                        <strong>{announcement.title}</strong>
                        <small>{announcement.body}</small>
                      </td>
                      <td>{statusBadge(announcement.status)}</td>
                      <td>
                        {announcement.publishFrom ? formatDateTime(announcement.publishFrom) : "Always"} →{" "}
                        {announcement.publishTo ? formatDateTime(announcement.publishTo) : "No end"}
                      </td>
                      <td>{renderActions(announcement)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Save</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(programEdits).length === 0 ? (
                  <tr>
                    <td className={styles.tableEmpty} colSpan={4}>
                      No program info keys yet.
                    </td>
                  </tr>
                ) : (
                  Object.keys(programEdits).map((key) => (
                    <tr key={key}>
                      <td>
                        <strong>{key}</strong>
                      </td>
                      <td>
                        <input
                          className={styles.input}
                          style={{ width: "100%", minWidth: 220 }}
                          value={programEdits[key].value}
                          onChange={(event) =>
                            setProgramEdits((current) => ({
                              ...current,
                              [key]: { ...current[key], value: event.target.value },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <select
                          className={styles.select}
                          value={programEdits[key].status}
                          onChange={(event) =>
                            setProgramEdits((current) => ({
                              ...current,
                              [key]: { ...current[key], status: event.target.value as "confirmed" | "placeholder" },
                            }))
                          }
                        >
                          <option value="placeholder">placeholder</option>
                          <option value="confirmed">confirmed</option>
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSmall} ${styles.btnPrimary}`}
                          disabled={!canManage}
                          onClick={() => void saveProgramInfo(key)}
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {tab === "program-info" && (
          <p className={styles.hint} style={{ padding: "10px 17px" }}>
            Values marked <strong>placeholder</strong> are shown publicly as unconfirmed. Set them to <strong>confirmed</strong> once the CAP team approves the copy.
          </p>
        )}
      </div>

      {(creating || editingId) && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div>
                <h3>{creating ? "New content" : "Edit content"}</h3>
                <p>{canManage ? "Publishing is audited." : "You have view-only access."}</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {tab === "faqs" && (
                <>
                  <div className={styles.grid}>
                    <div className={styles.field}>
                      <label>Group</label>
                      <select className={styles.select} value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })}>
                        {["about", "benefits", "tasks", "points", "updates"].map((group) => (
                          <option key={group} value={group}>
                            {group}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Status</label>
                      <select className={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        {["draft", "published", "hidden"].map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Display order</label>
                      <input className={styles.input} value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label>Question</label>
                    <input className={styles.input} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
                  </div>
                  <div className={styles.field}>
                    <label>Answer</label>
                    <textarea className={styles.textarea} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
                  </div>
                  <label className={styles.hint} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={form.requiresConfirmation}
                      onChange={(e) => setForm({ ...form, requiresConfirmation: e.target.checked })}
                    />
                    Requires confirmation before publishing
                  </label>
                </>
              )}

              {tab === "benefits" && (
                <>
                  <div className={styles.grid}>
                    <div className={styles.field}>
                      <label>Title</label>
                      <input className={styles.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Icon key</label>
                      <input className={styles.input} value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Tier</label>
                      <select className={styles.select} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                        {["included", "experience", "merit_based"].map((tier) => (
                          <option key={tier} value={tier}>
                            {tier}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Status</label>
                      <select className={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        {["draft", "published", "hidden"].map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Display order</label>
                      <input className={styles.input} value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label>Description</label>
                    <textarea className={styles.textarea} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                </>
              )}

              {tab === "milestones" && (
                <>
                  <div className={styles.grid}>
                    <div className={styles.field}>
                      <label>Label</label>
                      <input className={styles.input} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Phase</label>
                      <input className={styles.input} value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Start</label>
                      <input type="datetime-local" className={styles.input} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>End</label>
                      <input type="datetime-local" className={styles.input} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Status</label>
                      <select className={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        {["draft", "published", "hidden"].map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Display order</label>
                      <input className={styles.input} value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} />
                    </div>
                  </div>
                  <label className={styles.hint} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={form.isPeak} onChange={(e) => setForm({ ...form, isPeak: e.target.checked })} />
                    Peak period
                  </label>
                </>
              )}

              {tab === "testimonials" && (
                <>
                  <div className={styles.grid}>
                    <div className={styles.field}>
                      <label>Participant name</label>
                      <input className={styles.input} value={form.participantName} onChange={(e) => setForm({ ...form, participantName: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Source</label>
                      <select className={styles.select} value={form.sourceLabel} onChange={(e) => setForm({ ...form, sourceLabel: e.target.value })}>
                        {["alumni", "pilot", "organising_team"].map((source) => (
                          <option key={source} value={source}>
                            {source.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Consent</label>
                      <select className={styles.select} value={form.consentStatus} onChange={(e) => setForm({ ...form, consentStatus: e.target.value })}>
                        <option value="granted">granted</option>
                        <option value="withdrawn">withdrawn</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Status</label>
                      <select className={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        {["draft", "published", "hidden"].map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>College</label>
                      <input className={styles.input} value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Year</label>
                      <input className={styles.input} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Role / cohort</label>
                      <input className={styles.input} value={form.roleOrCohort} onChange={(e) => setForm({ ...form, roleOrCohort: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Photo URL</label>
                      <input className={styles.input} value={form.photoUrl} onChange={(e) => setForm({ ...form, photoUrl: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Display order</label>
                      <input className={styles.input} value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label>Quote</label>
                    <textarea className={styles.textarea} value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} />
                  </div>
                  <div className={styles.field}>
                    <label>Verified achievement</label>
                    <input
                      className={styles.input}
                      value={form.verifiedAchievement}
                      onChange={(e) => setForm({ ...form, verifiedAchievement: e.target.value })}
                    />
                  </div>
                </>
              )}

              {tab === "announcements" && (
                <>
                  <div className={styles.grid}>
                    <div className={styles.field}>
                      <label>Title</label>
                      <input className={styles.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                    </div>
                    <div className={styles.field}>
                      <label>Status</label>
                      <select className={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        {["draft", "published", "archived"].map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Publish from</label>
                      <input
                        type="datetime-local"
                        className={styles.input}
                        value={form.publishFrom}
                        onChange={(e) => setForm({ ...form, publishFrom: e.target.value })}
                      />
                    </div>
                    <div className={styles.field}>
                      <label>Publish to</label>
                      <input
                        type="datetime-local"
                        className={styles.input}
                        value={form.publishTo}
                        onChange={(e) => setForm({ ...form, publishTo: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label>Body</label>
                    <textarea className={styles.textarea} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <div className={styles.modalFoot}>
              <button type="button" className={styles.btn} onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving || !canManage} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
