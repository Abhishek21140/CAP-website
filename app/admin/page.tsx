"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import styles from "./admin.module.css";

type Section = "Participants" | "Submissions" | "Task Store" | "Leaderboard" | "Content";

const sections: Section[] = ["Participants", "Submissions", "Task Store", "Leaderboard", "Content"];

const participants = [
  { name: "Aarav Sharma", roll: "24EE1001", college: "IIT BHU", email: "aarav@example.test", points: 420, rank: 1, status: "Active" },
  { name: "Riya Verma", roll: "23CS2044", college: "NIT Patna", email: "riya@example.test", points: 395, rank: 2, status: "Active" },
  { name: "Kabir Singh", roll: "22EC3120", college: "BHU", email: "kabir@example.test", points: 360, rank: 3, status: "Active" },
  { name: "Meera Nair", roll: "23IT0988", college: "IIIT Allahabad", email: "meera@example.test", points: 310, rank: 4, status: "Pending" },
  { name: "Dev Patel", roll: "24ME4410", college: "MNNIT", email: "dev@example.test", points: 290, rank: 5, status: "Active" },
];

const submissions = [
  { participant: "Aarav Sharma", task: "Campus Poster Challenge", submitted: "Oct 21 · 11:30 PM", timing: "Late", status: "Pending review", score: "—" },
  { participant: "Kabir Singh", task: "Campus Poster Challenge", submitted: "Oct 20 · 09:10 PM", timing: "On time", status: "Approved", score: "90 / 100" },
  { participant: "Meera Nair", task: "Campus Poster Challenge", submitted: "Oct 20 · 11:58 PM", timing: "On time", status: "Needs changes", score: "—" },
];

const tasks = [
  { name: "Campus Poster Challenge", due: "Oct 20 · 11:59 PM IST", type: "Proof link", points: 100, status: "Live" },
  { name: "Quiz 2: Entrepreneurship", due: "Oct 27 · 11:59 PM IST", type: "Quiz", points: 50, status: "Scheduled" },
  { name: "Reel: Why Join E-Cell", due: "Nov 03 · 11:59 PM IST", type: "Proof link", points: 100, status: "Draft" },
];

const contentItems = [
  { name: "Program duration", type: "Program info", status: "Placeholder" },
  { name: "How are points awarded?", type: "FAQ · Points", status: "Draft" },
  { name: "Learn by doing", type: "Benefit", status: "Published" },
];

function Status({ children }: { children: string }) {
  return <span className={`${styles.status} ${children === "Active" || children === "Approved" || children === "Live" || children === "Published" ? styles.statusGood : ""}`}><span aria-hidden="true" />{children}</span>;
}

export default function AdminPage() {
  const [activeSection, setActiveSection] = useState<Section>("Participants");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [collegeFilter, setCollegeFilter] = useState("All colleges");

  const filteredParticipants = useMemo(() => {
    const query = search.trim().toLowerCase();
    return participants.filter((person) => {
      const matchesSearch = !query || [person.name, person.email, person.roll, person.college].some((value) => value.toLowerCase().includes(query));
      const matchesStatus = statusFilter === "All statuses" || person.status === statusFilter;
      const matchesCollege = collegeFilter === "All colleges" || person.college === collegeFilter;
      return matchesSearch && matchesStatus && matchesCollege;
    });
  }, [search, statusFilter, collegeFilter]);

  return (
    <main className={styles.adminShell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="CAP Admin home"><span className={styles.brandMark}>C</span><span><strong>CAP Admin</strong><small>PROGRAM OPERATIONS</small></span></Link>
        <div className={styles.topbarRight}><span className={styles.previewTag}>FRONTEND PREVIEW · SAMPLE DATA</span><Link className={styles.siteLink} href="/">View public site ↗</Link><button className={styles.avatar} aria-label="Admin account">A</button></div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Admin sections">
          <span className={styles.navLabel}>WORKSPACE</span>
          {sections.map((section, index) => <button key={section} className={`${styles.navItem} ${activeSection === section ? styles.navActive : ""}`} onClick={() => setActiveSection(section)} aria-current={activeSection === section ? "page" : undefined}><span className={styles.navIcon}>{["▦", "☷", "◷", "↗", "▤"][index]}</span>{section}{section === "Submissions" && <span className={styles.navCount}>14</span>}</button>)}
          <div className={styles.sidebarBottom}><span className={styles.navLabel}>SYSTEM</span><div className={styles.roleCard}><span className={styles.roleDot} />Preview role <strong>Super Admin</strong></div></div>
        </aside>

        <section className={styles.workspace}>
          <div className={styles.pageHeading}><div><div className={styles.breadcrumb}>WORKSPACE <span>/</span> {activeSection.toUpperCase()}</div><h1>{activeSection}</h1><p>{activeSection === "Participants" ? "Search and review participant records." : `Manage ${activeSection.toLowerCase()} in one place.`}</p></div><button className={styles.primaryButton} disabled title="Available when the admin service is connected">＋ {activeSection === "Participants" ? "Add participant" : activeSection === "Task Store" ? "New task" : "New item"}</button></div>

          <div className={styles.previewNote}><span aria-hidden="true">i</span><p>This is a frontend preview with sample data. Sign-in, saving, exports and admin actions need the backend connection.</p></div>

          {activeSection === "Participants" ? <>
            <div className={styles.metrics}>
              <article><span>TOTAL PARTICIPANTS</span><strong>312</strong><small>Across all campuses</small></article>
              <article><span>ACTIVE</span><strong>286</strong><small>Ready for missions</small></article>
              <article><span>PENDING APPROVAL</span><strong>18</strong><small>Awaiting review</small></article>
              <article><span>INACTIVE</span><strong>8</strong><small>Not currently participating</small></article>
            </div>
            <div className={styles.tableCard}>
              <div className={styles.tableToolbar}><div><h2>Participant directory</h2><p>Search by name, email, roll number or college</p></div><button className={styles.secondaryButton} disabled title="CSV export will be connected to the backend">Export CSV ↓</button></div>
              <div className={styles.filters}><label className={styles.searchBox}><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search participants…" aria-label="Search participants by name, email, roll number or college" /></label><label className={styles.filterLabel}><span className={styles.srOnly}>Filter by college</span><select value={collegeFilter} onChange={(event) => setCollegeFilter(event.target.value)}><option>All colleges</option>{[...new Set(participants.map((person) => person.college))].map((college) => <option key={college}>{college}</option>)}</select></label><label className={styles.filterLabel}><span className={styles.srOnly}>Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option><option>Active</option><option>Pending</option></select></label></div>
              <div className={styles.tableScroll}><table><thead><tr><th>PARTICIPANT</th><th>ROLL NUMBER</th><th>COLLEGE</th><th>POINTS</th><th>RANK</th><th>STATUS</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead><tbody>{filteredParticipants.map((person) => <tr key={person.roll}><td><strong>{person.name}</strong><small>{person.email}</small></td><td>{person.roll}</td><td>{person.college}</td><td className={styles.points}>{person.points}</td><td>#{person.rank}</td><td><Status>{person.status}</Status></td><td><button className={styles.rowAction} title="Editing will be available when connected" disabled>Edit</button></td></tr>)}{filteredParticipants.length === 0 && <tr><td colSpan={7} className={styles.empty}>No participants match those filters.</td></tr>}</tbody></table></div>
              <div className={styles.tableFooter}><span>Showing {filteredParticipants.length ? 1 : 0}–{filteredParticipants.length} of 312 sample records</span><div><button disabled aria-label="Previous page">←</button><button className={styles.pageNumber} aria-current="page">1</button><button disabled aria-label="Next page">→</button></div></div>
            </div>
          </> : <div className={styles.tableCard}>
            <div className={styles.tableToolbar}><div><h2>{activeSection} overview</h2><p>Simple, table-first view for routine program operations.</p></div>{activeSection !== "Leaderboard" && <button className={styles.secondaryButton} disabled title="Available when the admin service is connected">Export CSV ↓</button>}</div>
            <div className={styles.tableScroll}>
              {activeSection === "Submissions" && <table><thead><tr><th>PARTICIPANT</th><th>TASK</th><th>SUBMITTED (IST)</th><th>TIMING</th><th>STATUS</th><th>AWARDED</th></tr></thead><tbody>{submissions.map((row) => <tr key={`${row.participant}-${row.task}`}><td><strong>{row.participant}</strong></td><td>{row.task}</td><td>{row.submitted}</td><td>{row.timing}</td><td><Status>{row.status}</Status></td><td>{row.score}</td></tr>)}</tbody></table>}
              {activeSection === "Task Store" && <table><thead><tr><th>TASK</th><th>TYPE</th><th>POINTS</th><th>DEADLINE (IST)</th><th>STATUS</th></tr></thead><tbody>{tasks.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.type}</td><td>{row.points}</td><td>{row.due}</td><td><Status>{row.status}</Status></td></tr>)}</tbody></table>}
              {activeSection === "Leaderboard" && <table><thead><tr><th>RANK</th><th>PARTICIPANT</th><th>COLLEGE</th><th>POINTS</th><th>STATE</th></tr></thead><tbody>{participants.slice(0, 4).map((row) => <tr key={row.roll}><td>#{row.rank}</td><td><strong>{row.name}</strong></td><td>{row.college}</td><td className={styles.points}>{row.points}</td><td><Status>Live</Status></td></tr>)}</tbody></table>}
              {activeSection === "Content" && <table><thead><tr><th>CONTENT ITEM</th><th>TYPE</th><th>STATUS</th><th>ORDER</th></tr></thead><tbody>{contentItems.map((row, index) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.type}</td><td><Status>{row.status}</Status></td><td>{index + 1}</td></tr>)}</tbody></table>}
            </div>
            <div className={styles.tableFooter}><span>Sample preview data · Changes are not saved</span><span className={styles.tableHint}>Actions and permissions are handled when backend access is configured.</span></div>
          </div>}
          <footer className={styles.footer}>CAP PROGRAM ADMINISTRATION <span>·</span> LIGHTWEIGHT WORKSPACE</footer>
        </section>
      </div>
    </main>
  );
}
