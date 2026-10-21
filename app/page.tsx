"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const faqGroups = [
  { id: "about", label: "ABOUT CAP", questions: [
    ["What is the Campus Ambassador Program?", "Students represent the organisation on campus, complete missions across promotion, content, events and quizzes, and earn points that shape their place on a live leaderboard."],
    ["Who is eligible to apply?", "Eligibility will be announced by the CAP team."],
    ["How does the application and selection process work?", "The journey starts with registration and email verification. Whether access is immediate or approval-based, along with the selection criteria and result date, will be announced."],
    ["Is this an internship or a campus ambassador role?", "CAP is a campus ambassador program. Its formal classification will be confirmed by CAP leadership."],
  ] },
  { id: "benefits", label: "BENEFITS", questions: [
    ["What will participants gain?", "Build experience through real campus tasks, reviewer feedback and a transparent view of points and rank. Any rewards or recognition will be listed only after confirmation; no outcome is guaranteed."],
    ["What practical skills and experience can participants develop?", "Tasks offer opportunities to practise communication, outreach, promotion, content creation, event coordination, teamwork and leadership. Your experience depends on your participation."],
    ["Are there monetary rewards, a stipend or other financial benefits?", "No monetary reward, stipend or financial benefit is promised at this time. Any confirmed rewards will be listed here."],
    ["Is there any registration fee?", "Fee details will be confirmed before registration opens."],
    ["Will participants receive certificates or letters of recommendation?", "Not promised. Any certificate or recommendation, and who qualifies, will be announced if confirmed."],
    ["Are internship opportunities or referrals available?", "No internship or referral is promised."],
  ] },
  { id: "tasks", label: "TIME & TASKS", questions: [
    ["How much time must participants commit each week?", "To be announced."],
    ["What tasks will ambassadors perform?", "Missions may include promotion, content, events and quizzes. Most tasks use a public Google Drive link as proof; quizzes are completed on the site. Weekly task count: To be announced."],
    ["Can students participate alongside regular studies?", "The program is intended to run alongside classes. Weekly hours, peak weeks and fixed IST deadlines will be shared when confirmed. No academic accommodation is promised."],
  ] },
  { id: "points", label: "POINTS & DEADLINES", questions: [
    ["How are points awarded and rankings calculated?", "Reviewers award points up to each task's maximum. Any approved late penalty is deducted from that score, with a floor of zero. Rankings use final points. Tie-break details will be shared with participants."],
    ["What happens if I miss a deadline?", "After the approved grace period, a penalty may apply for each started 24 hours until the cutoff. After the cutoff, submissions lock. Quizzes close at their hard cutoff. Final values will be published before tasks open."],
    ["Can I resubmit or request an extension?", "You can resubmit before the deadline, or after a reviewer requests changes. Resubmission does not reset a late penalty. Extensions are granted by admins; the request process will be announced."],
  ] },
  { id: "updates", label: "UPDATES & SUPPORT", questions: [
    ["How will selected participants receive updates?", "Tasks, review status, feedback and results will appear on the dashboard. Approved announcements will appear here. Reminder channels are still to be announced."],
    ["Whom can participants contact for assistance?", "Support contact details will be announced by the CAP team."],
  ] },
];

const journey = [
  ["01", "Discover", "Meet the mission and see what CAP is about."],
  ["02", "Check your fit", "Explore program facts, benefits and answers."],
  ["03", "Apply", "Register when applications open."],
  ["04", "Get cleared", "Verify your email and await approval if required."],
  ["05", "Enter the HQ", "Your dashboard brings tasks, points and updates together."],
  ["06", "Take the mission", "Complete a campus task or timed quiz."],
  ["07", "Send proof", "Share a Drive link and track reviewer feedback."],
  ["08", "Rise in rank", "Follow your score and the public leaderboard."],
];

const benefits = [
  ["✳", "Find your voice", "Practise communication and public speaking through real campus work.", "EXPERIENCE"],
  ["◈", "Make ideas travel", "Explore outreach, promotion and content creation.", "EXPERIENCE"],
  ["⌘", "Lead from the ground", "Build coordination and event experience with your campus community.", "EXPERIENCE"],
  ["◎", "Meet your people", "Connect with peers, organisers and the entrepreneurship ecosystem.", "EXPERIENCE"],
  ["⬡", "Learn by doing", "Get practical exposure to entrepreneurship and community-building.", "EXPERIENCE"],
  ["↗", "See your progress", "Every active participant can track points, review feedback and rank.", "INCLUDED"],
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true" className="arrow">{diagonal ? "↗" : "→"}</span>;
}

function HexMark() {
  return <span className="hex-mark" aria-hidden="true"><span>✦</span></span>;
}

export default function Home() {
  const [activeGroup, setActiveGroup] = useState("about");
  const [openQuestions, setOpenQuestions] = useState<string[]>(["about-0"]);
  const [menuOpen, setMenuOpen] = useState(false);
  const faqRef = useRef<HTMLElement>(null);
  const worldtreeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      const match = hash.match(/^#faq-(.+)$/);
      if (!match) return;
      const group = faqGroups.find((item) => item.id === match[1]);
      if (group) {
        setActiveGroup(group.id);
        setOpenQuestions([`${group.id}-0`]);
        window.setTimeout(() => faqRef.current?.scrollIntoView(), 100);
      }
    };

    window.addEventListener("hashchange", handleHash);
    if (window.location.hash) {
      queueMicrotask(handleHash);
    }
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  useEffect(() => {
    const background = worldtreeRef.current;
    const image = background?.querySelector(".worldtree-image") as HTMLImageElement | null;
    if (!background || !image || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const updateView = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const travel = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const progress = Math.max(0, Math.min(1, window.scrollY / travel));
        image.style.objectPosition = `${12 + progress * 76}% ${34 + progress * 30}%`;
        image.style.transform = `scale(${1.12 + progress * 0.15})`;
      });
    };

    updateView();
    window.addEventListener("scroll", updateView, { passive: true });
    window.addEventListener("resize", updateView);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateView);
      window.removeEventListener("resize", updateView);
    };
  }, []);

  const toggleQuestion = (key: string) => {
    setOpenQuestions((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const moveFaqFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number, count: number) => {
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % count;
    else if (event.key === "ArrowUp") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    faqRef.current?.querySelectorAll<HTMLButtonElement>(".faq-question")[next]?.focus();
  };

  const currentGroup = faqGroups.find((group) => group.id === activeGroup)!;

  return (
    <main className="site-shell">
      <div className="worldtree-background" aria-hidden="true" ref={worldtreeRef}>
        <Image src="/images/multiverse-canopy.webp" alt="" fill sizes="100vw" className="worldtree-image" />
        <div className="worldtree-shade" />
        <Image src="/images/doom-mask-watcher.webp" alt="" width={800} height={1200} sizes="(max-width: 640px) 70vw, 45vw" className="worldtree-mask" />
      </div>
      <div className="site-content">
      <div className="announcement"><span className="live-dot" /> INTEL UPDATE <span className="announcement-divider">/</span> THE NEXT GENERATION OF CAMPUS LEADERS STARTS HERE <a href="#about">DECRYPT <Arrow /></a></div>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="CAP home"><HexMark /><span className="brand-name">CAMPUS<span>·</span> ASSEMBLY<span className="brand-sub">INITIATIVE  /  2026</span></span></a>
        <button className="menu-toggle" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? "×" : "☰"}</button>
        <nav className={menuOpen ? "main-nav nav-open" : "main-nav"} aria-label="Main navigation" onClick={() => setMenuOpen(false)}>
          <a href="#about">THE PROGRAM</a><a href="#missions">MISSIONS</a><a href="#leaderboard">RANKINGS</a><a href="#faq">INTEL / FAQ</a>
          <a className="nav-join" href="#join">JOIN THE ALLIANCE <Arrow diagonal /></a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-orbit orbit-one" aria-hidden="true" /><div className="hero-orbit orbit-two" aria-hidden="true" />
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> CAMPUS AMBASSADOR PROGRAM <span className="eyebrow-index">[ EARTH-616 / CAP ]</span></div>
          <h1>THE FUTURE<br />IS <span>ASSEMBLED.</span></h1>
          <p className="hero-tagline">AS<i>SEMBLE</i> YOUR CAMPUS.</p>
          <p className="hero-description">Big change doesn’t begin in a boardroom.<br />It starts right where you are.</p>
          <div className="hero-actions"><a className="button button-primary" href="#join">STEP INTO THE INITIATIVE <Arrow diagonal /></a><a className="button button-ghost" href="#about">EXPLORE THE BRIEF <span>↓</span></a></div>
          <div className="hero-caption"><span className="caption-mark">✳</span><span>FOR THE ONES WHO<br />MOVE THEIR WORLD.</span><span className="caption-rule" /><span className="caption-coordinate">19°04&apos; N / 72°52&apos; E</span></div>
        </div>
        <div className="hero-art" role="img" aria-label="Original abstract stained glass window in a shadowy green hall">
          <div className="hero-art-noise" /><div className="hero-stained-glass" />
          <div className="art-stamp"><span>FIELD</span><strong>01</strong><span>ENERGY / RISING</span></div>
          <div className="art-caption">AN ORIGINAL SIGNAL<br />FROM THE NEXT FRONTIER</div>
          <div className="art-side-label">DOOMSDAY PROTOCOL <i>—</i> INITIATED</div>
        </div>
        <div className="hero-bottom"><span>SCROLL TO EXPLORE <b>↓</b></span><span>NO. 001 <i>—</i> CAMPUS OPERATIONS</span><span>INDEPENDENT FAN INITIATIVE <i>✳</i></span></div>
      </section>

      <div className="signal-strip"><div className="signal-track"><span>ONE CAMPUS AT A TIME</span><b>✳</b><span>IDEAS INTO ACTION</span><b>✳</b><span>YOUR WORLD NEEDS YOU</span><b>✳</b><span>ONE CAMPUS AT A TIME</span><b>✳</b><span>IDEAS INTO ACTION</span><b>✳</b><span>YOUR WORLD NEEDS YOU</span><b>✳</b></div></div>

      <section className="section program-section" id="about">
        <div className="section-kicker"><span>01 / THE BRIEF</span><span>CLASSIFIED // PUBLIC ACCESS</span></div>
        <div className="program-layout">
          <div><p className="overline">A MOVEMENT, NOT A TITLE</p><h2>YOUR CAMPUS.<br /><em>YOUR</em> FRONTIER.</h2></div>
          <div className="program-intro"><p>CAP is a campus ambassador program for students who want to turn good ideas into real momentum. Take on missions in promotion, content, events and quizzes. Show your work, grow through feedback and see your progress on a live leaderboard.</p><a className="text-link" href="#journey">HOW IT WORKS <Arrow /></a></div>
        </div>
        <div className="intel-grid">
          <article className="intel-card intel-card-main"><div className="card-corner">CAP / 01</div><span className="intel-icon">◉</span><p className="overline">THE INITIATIVE</p><h3>Make your mark<br />where it matters.</h3><p>Represent. Create. Rally your campus. Every mission is a chance to make something happen.</p><div className="card-bottom"><span>PROGRAM OVERVIEW</span><span>→</span></div></article>
          <article className="intel-card intel-card-facts"><div className="card-corner">STATUS / PENDING</div><p className="overline">MISSION PARAMETERS</p><h3>Know the facts.</h3><div className="fact-row"><span>PROGRAM DURATION</span><strong>TO BE ANNOUNCED</strong></div><div className="fact-row"><span>HOURS / WEEK</span><strong>TO BE ANNOUNCED</strong></div><div className="fact-row"><span>TASKS / WEEK</span><strong>TO BE ANNOUNCED</strong></div><div className="fact-row"><span>ELIGIBILITY</span><strong>TO BE ANNOUNCED</strong></div><div className="fact-row"><span>REWARDS</span><strong>TO BE ANNOUNCED</strong></div><span className="facts-note">No placeholder facts. We’ll update this briefing when confirmed.</span></article>
          <article className="intel-card intel-card-time"><span className="time-glyph">◷</span><p className="overline">YOUR TIME MATTERS</p><h3>Plan your<br /><em>own pace.</em></h3><p>Time commitment and peak weeks will be published before registration opens.</p><div className="time-status"><span className="status-dot" /> COMMITMENT / PENDING</div></article>
        </div>
        <div className="timeline-heading"><span>THE OPERATION TIMELINE</span><span>DATES LOCKED BY CAP HQ</span></div>
        <div className="timeline"><div className="timeline-line" />{["REGISTRATION", "ONBOARDING", "MISSIONS", "FINAL RANKINGS"].map((item, index) => <div className="timeline-stop" key={item}><span className={index === 0 ? "timeline-node pending" : "timeline-node"}>{index + 1}</span><strong>{item}</strong><small>TO BE ANNOUNCED</small></div>)}</div>
      </section>

      <section className="journey-section" id="journey"><div className="section journey-inner"><div className="section-kicker"><span>02 / YOUR STORY</span><span>THE ROAD FROM HERE</span></div><div className="journey-title"><div><p className="overline">EIGHT STEPS. ONE BIGGER PICTURE.</p><h2>FROM <em>HERE</em><br />TO HERO.</h2></div><p>Every great mission has a map. Here’s yours — from first contact to your name on the board.</p></div><div className="journey-grid">{journey.map(([num, title, desc]) => <article className="journey-step" key={num}><span className="step-num">{num}</span><span className="step-spark">✳</span><h3>{title}</h3><p>{desc}</p><span className="step-path">{num === "08" ? "MISSION COMPLETE" : "NEXT TRANSMISSION →"}</span></article>)}</div></div></section>

      <section className="section benefits-section" id="benefits"><div className="section-kicker"><span>03 / WHAT YOU GAIN</span><span>SKILLS ARE THE SUPERPOWER</span></div><div className="benefits-head"><div><p className="overline">WHY JOIN CAP?</p><h2>LEVEL UP.<br /><em>FOR REAL.</em></h2></div><p>Not every win comes with a trophy. Some you carry into every room after this one.</p></div><div className="benefit-grid">{benefits.map(([icon, title, copy, tier], index) => <article className="benefit-card" key={title}><div className="benefit-card-top"><span className="benefit-icon">{icon}</span><span className="benefit-index">0{index + 1}</span></div><h3>{title}</h3><p>{copy}</p><span className={tier === "INCLUDED" ? "tier-tag tier-included" : "tier-tag"}>{tier === "INCLUDED" ? "◆" : "◇"} {tier}</span></article>)}</div><div className="benefits-foot"><span>✳</span> Rewards, certificates and career opportunities are not promised. Confirmed details will appear here.</div></section>

      <section className="missions-section" id="missions"><div className="section missions-inner"><div className="section-kicker"><span>04 / MISSION CONTROL</span><span>YOUR NEXT MOVE AWAITS</span></div><div className="missions-head"><div><p className="overline">THE BRIEFING ROOM</p><h2>MISSIONS<br /><em>INCOMING.</em></h2></div><a className="text-link" href="#join">PARTICIPANT ACCESS <Arrow diagonal /></a></div><div className="mission-grid"><article className="mission-card mission-feature"><div className="mission-image"><div className="mission-image-grid" /><div className="mission-target"><span>✳</span></div><span className="mission-image-label">FIELD OPERATIONS / 001</span><span className="mission-image-corner">CAP</span></div><div className="mission-details"><div className="mission-meta"><span><i className="status-dot" /> TRANSMISSION PENDING</span><span>TYPE / CAMPUS</span></div><h3>First contact.</h3><p>New missions will appear here once the program opens. Check back for your first campus operation.</p><div className="mission-footer"><span>DEADLINE <strong>TO BE ANNOUNCED</strong></span><span>POINTS <strong>—</strong></span><span className="mission-lock">⌑ ACCESS LOCKED</span></div></div></article><article className="mission-card quiz-card"><div className="quiz-graphic"><div className="quiz-orbit" /><span>?</span><small>KNOWLEDGE / 002</small></div><div className="mission-details"><div className="mission-meta"><span><i className="status-dot" /> STANDBY</span><span>TYPE / QUIZ</span></div><h3>Test your intel.</h3><p>Timed in-site quizzes will challenge what you know. Objective answers are scored automatically.</p><div className="mission-footer"><span>ATTEMPTS <strong>1 / MISSION</strong></span><span className="mission-lock">⌑ ACCESS LOCKED</span></div></div></article></div><div className="proof-callout"><span className="proof-icon">↗</span><p><strong>PROOF OF MISSION</strong><br />Submissions use a public Google Drive link. Set sharing to <b>“Anyone with the link can view”</b>. Your files stay yours — we never upload them to our servers.</p><a href="#faq">SUBMISSION INTEL <Arrow /></a></div></div></section>

      <section className="section leaderboard-section" id="leaderboard"><div className="section-kicker"><span>05 / THE ALLIANCE INDEX</span><span>PUBLIC RANKINGS / TOP OPERATIVES</span></div><div className="leaderboard-head"><div><p className="overline">THE LEADERBOARD</p><h2>EVERY POINT<br />TELLS A <em>STORY.</em></h2></div><div className="leaderboard-status"><span className="status-dot" /> AWAITING FIRST OPERATIVES <small>RANKINGS WILL BE LIVE WHEN MISSIONS BEGIN</small></div></div><div className="leaderboard-table"><div className="leaderboard-columns"><span>RANK</span><span>OPERATIVE</span><span>CAMPUS</span><span>POINTS</span><span>HERO TIER</span></div><div className="leaderboard-empty"><HexMark /><strong>THE BOARD IS QUIET.</strong><p>The first rankings will appear here when the missions begin.</p><span>NO OPERATIVES ON RECORD</span></div></div><div className="leaderboard-note"><span>ⓘ</span> Public rankings show display name, college, final points and tier only.</div></section>

      <section className="faq-section" id="faq" ref={faqRef}><div className="section"><div className="section-kicker"><span>06 / FIELD INTEL</span><span>18 QUESTIONS / 05 CHANNELS</span></div><div className="faq-heading"><div><p className="overline">BEFORE YOU SUIT UP</p><h2>GOOD QUESTIONS.<br /><em>STRAIGHT ANSWERS.</em></h2></div><p>Clarity is a superpower. Find the signal before you join the mission.</p></div><div className="faq-layout"><div className="faq-tabs" role="tablist" aria-label="FAQ categories">{faqGroups.map((group, index) => <button className={activeGroup === group.id ? "faq-tab active" : "faq-tab"} role="tab" aria-selected={activeGroup === group.id} aria-controls="faq-panel" id={`tab-${group.id}`} onClick={() => {setActiveGroup(group.id); setOpenQuestions([`${group.id}-0`]);}} key={group.id}><span>0{index + 1}</span>{group.label}<Arrow /></button>)}</div><div className="faq-panel" id="faq-panel" role="tabpanel" aria-labelledby={`tab-${currentGroup.id}`}>{currentGroup.questions.map(([question, answer], index) => {const key = `${currentGroup.id}-${index}`; const isOpen = openQuestions.includes(key); return <article className={isOpen ? "faq-item faq-open" : "faq-item"} id={`faq-${currentGroup.id}-${index + 1}`} key={key}><button className="faq-question" id={`question-${key}`} aria-expanded={isOpen} aria-controls={`answer-${key}`} onClick={() => toggleQuestion(key)} onKeyDown={(event) => moveFaqFocus(event, index, currentGroup.questions.length)}><span className="faq-q-index">Q{String(faqGroups.flatMap((item) => item.questions).findIndex((item) => item[0] === question) + 1).padStart(2, "0")}</span><span>{question}</span><span className="faq-plus" aria-hidden="true">{isOpen ? "−" : "+"}</span></button><div className="faq-answer" id={`answer-${key}`} role="region" aria-labelledby={`question-${key}`} hidden={!isOpen}><p>{answer}</p></div></article>;})}</div></div></div></section>

      <section className="join-section" id="join"><div className="join-signal" aria-hidden="true">✳</div><div className="section join-inner"><div className="section-kicker"><span>07 / YOUR CALL</span><span>TRANSMISSION OPENING SOON</span></div><div className="join-content"><div><p className="overline">THE WORLD DOESN’T CHANGE ITSELF.</p><h2>YOUR MOVE,<br /><em>OPERATIVE.</em></h2><p className="join-copy">The alliance is forming. Get your field notes in order and be ready when registration goes live.</p><a className="button button-primary" href="#about">STAY ON THE SIGNAL <Arrow diagonal /></a></div><div className="join-panel"><span className="panel-stamp">CAP / ENLISTMENT DESK</span><HexMark /><p className="overline">RECRUITMENT STATUS</p><h3>NOT YET<br />AUTHORIZED.</h3><p>Registration details and eligibility will be published after leadership confirmation.</p><div className="panel-status"><span className="status-dot" /> ENLISTMENT / PENDING</div></div></div></div></section>

      <footer className="site-footer"><div className="footer-top"><a className="brand" href="#top"><HexMark /><span className="brand-name">CAMPUS<span>·</span> ASSEMBLY<span className="brand-sub">INITIATIVE  /  2026</span></span></a><p>Built by fans. Powered by campus spirit.<br />An independent fan-made initiative.</p><a className="back-top" href="#top">BACK TO TOP ↑</a></div><div className="footer-bottom"><span>© CAP / CAMPUS OPERATIONS</span><span>UNOFFICIAL FAN-MADE PROJECT. NOT AFFILIATED WITH MARVEL STUDIOS OR THE WALT DISNEY COMPANY.</span><span>EARTH-616 <i>✳</i></span></div></footer>
      </div>
    </main>
  );
}
