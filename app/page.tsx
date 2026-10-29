"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { FaqItem, LeaderboardResult, PublicContent } from "@/lib/repositories/types";

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

const benefits = [
  { icon: "pass", title: "Free E-Summit 2026 passes", copy: "Attend E-Summit and take part in the entrepreneurship conversations." },
  { icon: "percent", title: "Meet startup founders", copy: "Network with founders and learn from their experience." },
  { icon: "learning", title: "One-to-one mentorship", copy: "Get mentorship from startup founders." },
  { icon: "profile", title: "Get featured", copy: "Top performers may be featured on E-Cell IIT BHU social media." },
  { icon: "video", title: "Entrepreneurship Masterclass", copy: "Access sessions focused on the startup journey." },
  { icon: "medal", title: "BWU Cohort opportunity", copy: "Top participants can get an opportunity to enter the BWU Cohort and begin their entrepreneurship journey." },
  { icon: "book", title: "Startup Helpbook", copy: "Access E-Cell IIT BHU’s curated guide to starting up." },
  { icon: "ticket", title: "Newsletter feature", copy: "Top Campus Ambassadors may be featured in E-Cell IIT BHU’s weekly newsletter." },
  { icon: "certificate", title: "Internship certificate", copy: "Receive a certificate of internship verified by E-Cell IIT BHU." },
  { icon: "merch", title: "Sponsor goodies and resources", copy: "Get goodies, merchandise and learning resources from sponsors." },
];

type FaqGroup = { id: string; label: string; questions: [string, string][] };

const FAQ_GROUP_ORDER = ["about", "benefits", "tasks", "points", "updates"] as const;

const FAQ_GROUP_LABELS: Record<string, string> = {
  about: "ABOUT CAP",
  benefits: "BENEFITS",
  tasks: "TIME & TASKS",
  points: "POINTS & DEADLINES",
  updates: "UPDATES & SUPPORT",
};

/** Groups CMS FAQs into the same shape the static fallback uses. */
function groupFaqs(items: FaqItem[]): FaqGroup[] {
  const byGroup = new Map<string, [string, string][]>();
  for (const item of items) {
    const bucket = byGroup.get(item.group) ?? [];
    bucket.push([item.question, item.answer]);
    byGroup.set(item.group, bucket);
  }

  const ordered: FaqGroup[] = [];
  for (const id of FAQ_GROUP_ORDER) {
    const questions = byGroup.get(id);
    if (questions && questions.length > 0) {
      ordered.push({ id, label: FAQ_GROUP_LABELS[id] ?? id.toUpperCase(), questions });
      byGroup.delete(id);
    }
  }
  for (const [id, questions] of byGroup) {
    ordered.push({ id, label: FAQ_GROUP_LABELS[id] ?? id.toUpperCase(), questions });
  }
  return ordered;
}

function BenefitIcon({ name }: { name: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 3.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg className="benefit-icon-art" viewBox="0 0 96 96" aria-hidden="true" {...common}>
    {name === "pass" && <><path d="M15 29a8 8 0 0 0 0 16v23h66V45a8 8 0 0 1 0-16V16H15z"/><path d="M29 27v5m0 9v5m0 9v5" strokeDasharray="2 3"/><path d="m58 28 5 11 12 1-9 8 3 12-11-6-10 6 2-12-9-8 12-1z"/></>}
    {name === "percent" && <><path d="M48 9 57 15l11-1 5 10 10 5-1 12 6 9-6 10 1 11-10 5-5 10-12-1-9 6-10-6-11 1-5-10-10-5 1-12-6-9 6-10-1-11 10-5 5-10 12 1z"/><circle cx="36" cy="36" r="5"/><circle cx="61" cy="60" r="5"/><path d="m65 29-31 38"/></>}
    {name === "learning" && <><rect x="13" y="13" width="70" height="54" rx="4"/><path d="M8 76h80m-51 0 4-9h16l4 9"/><path d="m28 37 20-11 20 11-20 11zM36 42v10l12 7 12-7V42m9-5v16"/></>}
    {name === "profile" && <><rect x="12" y="16" width="72" height="64" rx="9"/><circle cx="36" cy="41" r="13"/><path d="M17 69c3-10 11-15 19-15s16 5 19 15m10-30h12m-12 12h12m-12 12h12"/></>}
    {name === "video" && <><rect x="13" y="18" width="58" height="47" rx="4"/><path d="m39 30 18 11-18 11zM8 75h72m-60-10v10m44-10v10"/><circle cx="29" cy="42" r="9"/><path d="M16 61c2-7 7-11 13-11"/></>}
    {name === "medal" && <><path d="M48 10 59 16l13-1 5 12 10 8-4 13 4 12-10 8-5 12-13-1-11 6-11-6-13 1-5-12-10-8 4-12-4-13 10-8 5-12 13 1z"/><circle cx="48" cy="43" r="18"/><path d="m39 63-7 23 16-8 10 8-4-23"/><path d="m48 31 4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z"/></>}
    {name === "book" && <><path d="M18 13h57a5 5 0 0 1 5 5v62H25a8 8 0 0 1-8-8V20a7 7 0 0 1 7-7z"/><path d="M27 14v58m-10 0c0-5 4-9 9-9h54M42 32h24m-24 12h24"/></>}
    {name === "ticket" && <><path d="M15 30a9 9 0 0 0 0 18v20h66V48a9 9 0 0 1 0-18V10H15z" transform="rotate(-35 48 45)"/><path d="m37 36 22 22m-18-26a4 4 0 1 0-6 6m26 14a4 4 0 1 0 6 6"/></>}
    {name === "certificate" && <><rect x="12" y="17" width="72" height="56" rx="5"/><path d="M24 31h29m-29 11h29m-29 11h20"/><circle cx="66" cy="45" r="12"/><path d="m59 56-2 27 9-7 9 7-2-27"/></>}
    {name === "merch" && <><path d="m30 17 18 8 18-8 17 12-10 17-9-5v41H32V41l-9 5-10-17z"/><path d="m40 38 8 9 8-9M39 90h19"/></>}
  </svg>;
}

function BenefitCards() {
  return <ul className="benefit-cards" aria-label="What you can gain from the program">
    {benefits.map((benefit, index) => <li className="benefit-flip-card" key={benefit.title} tabIndex={0} aria-label={`${benefit.title}: ${benefit.copy}`}>
      <div className="benefit-flip-inner">
        <div className="benefit-card-face benefit-card-front">
          <span className="benefit-card-number">{String(index + 1).padStart(2, "0")}</span>
          <span className="benefit-card-icon"><BenefitIcon name={benefit.icon} /></span>
          <h3>{benefit.title}</h3>
        </div>
        <div className="benefit-card-face benefit-card-back" aria-hidden="true">
          <span className="benefit-card-back-mark">✳</span>
          <h3>{benefit.title}</h3>
          <p>{benefit.copy}</p>
        </div>
      </div>
    </li>)}
  </ul>;
}


const journeySteps = [
  { id: "apply", title: "Apply", heading: "Apply and get updates", copy: "Register when applications open. Email verification and any selection steps will be explained before sign-up.", color: "purple" },
  { id: "choose", title: "Choose", heading: "Choose a program task", copy: "Tasks may include campus outreach, content, event support or an in-site quiz.", color: "blue" },
  { id: "submit", title: "Submit", heading: "Submit your work", copy: "Share a public Google Drive link for task proof, or complete quizzes on the site.", color: "red" },
  { id: "track", title: "Track", heading: "Review your progress", copy: "Track submission status, reviewer feedback, points and rankings from your dashboard.", color: "orange" },
];

const journeyStonePalette = {
  purple: { color: "#b347f1", light: "#a34bd8", main: "#7012b6", dark: "#21013e", glow: "#a000ff" },
  blue: { color: "#168ddd", light: "#36aee5", main: "#075aa5", dark: "#02183e", glow: "#008cff" },
  red: { color: "#ed233d", light: "#f04b59", main: "#c20b28", dark: "#410015", glow: "#ff102b" },
  orange: { color: "#f47a16", light: "#e99332", main: "#bd4800", dark: "#451300", glow: "#ff6a00" },
};

function JourneyGem({ id, color, active }: { id: string; color: keyof typeof journeyStonePalette; active: boolean }) {
  const stone = journeyStonePalette[color];
  const gradientId = `journey-gem-${id}`;
  return <svg className="journey-stone-gem" viewBox="0 0 100 120" aria-hidden="true" style={{ width: "clamp(58px, 7vw, 104px)", height: "clamp(70px, 8vw, 120px)", overflow: "visible", transform: active ? "translateY(-4px) scale(1.12)" : "none", filter: active ? `brightness(1.42) saturate(1.7) drop-shadow(0 0 18px ${stone.glow}) drop-shadow(0 0 40px ${stone.glow}) drop-shadow(0 0 70px ${stone.glow}cc)` : `brightness(.78) saturate(1.45) drop-shadow(0 0 10px ${stone.glow}99)`, transition: "transform .2s ease, filter .2s ease" }}>
    <defs>
      <linearGradient id={`${gradientId}-body`} x1="14%" y1="6%" x2="85%" y2="100%"><stop stopColor={stone.light} /><stop offset=".38" stopColor={stone.main} /><stop offset="1" stopColor={stone.dark} /></linearGradient>
      <linearGradient id={`${gradientId}-facet`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff" stopOpacity=".92" /><stop offset="1" stopColor={stone.color} stopOpacity=".12" /></linearGradient>
      <linearGradient id={`${gradientId}-shade`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={stone.light} stopOpacity=".62" /><stop offset="1" stopColor={stone.dark} stopOpacity=".82" /></linearGradient>
    </defs>
    <path d="M43 3 67 8 88 24 97 45 92 62 97 78 82 97 63 112 42 118 23 105 9 87 3 64 10 45 7 27 25 12Z" fill={`url(#${gradientId}-body)`} stroke={stone.color} strokeWidth="2.2" strokeLinejoin="round" />
    <path d="M43 3 25 12 10 45 43 57Z" fill={`url(#${gradientId}-facet)`} fillOpacity=".72" />
    <path d="m43 3 24 5 21 16-30 17-15 16Z" fill={stone.light} fillOpacity=".38" />
    <path d="m88 24 9 21-5 17-34-21Z" fill={stone.main} fillOpacity=".9" />
    <path d="m10 45 33 12-1 21L9 87 3 64Z" fill={stone.dark} fillOpacity=".42" />
    <path d="m43 57 15-16v37l-16 32-19-5L9 87Z" fill={`url(#${gradientId}-shade)`} />
    <path d="m58 78 34-16 5 16-15 19-19 15-21 6Z" fill={stone.dark} fillOpacity=".55" />
    <path d="m43 57 15-16m0 37 34-16M43 57 9 87m49-9-16 40m16-40 15 19" fill="none" stroke="#fff" strokeOpacity=".38" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>;
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true" className="arrow">{diagonal ? "↗" : "→"}</span>;
}

function HexMark() {
  return <span className="hex-mark" aria-hidden="true"><span>✦</span></span>;
}

function ECellLogo() {
  return <Image src="/images/ecell-logo-theme.png" alt="E-Cell IIT (BHU)" width={149} height={60} className="ecell-logo" />;
}

function AssembleLetters({ text, delay = 0 }: { text: string; delay?: number }) {
  return <span aria-hidden="true">{Array.from(text).map((letter, index) => <span className="hero-letter" key={`${letter}-${index}`} style={{ animationDelay: `${delay + index * 38}ms` }}>{letter}</span>)}</span>;
}

export default function Home() {
  const [activeGroup, setActiveGroup] = useState("about");
  const [openQuestions, setOpenQuestions] = useState<string[]>(["about-0"]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [entryPhase, setEntryPhase] = useState<"intro" | "ignition" | "fracture" | "done">("intro");
  const entryOpen = entryPhase !== "done";
  const [activeJourneyStep, setActiveJourneyStep] = useState<string | null>(null);
  const [publicContent, setPublicContent] = useState<PublicContent | null>(null);
  const [publicLeaderboard, setPublicLeaderboard] = useState<LeaderboardResult | null>(null);
  const faqRef = useRef<HTMLElement>(null);
  const worldtreeRef = useRef<HTMLDivElement>(null);
  const dustCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastRevealSoundAtRef = useRef(0);

  // Public CMS content + leaderboard (falls back to the static copy below on failure).
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/content/public");
        if (!response.ok) return;
        const data = (await response.json()) as PublicContent;
        if (!cancelled) setPublicContent(data);
      } catch {
        // Static fallback stays in place.
      }
    })();

    void (async () => {
      try {
        const response = await fetch("/api/leaderboard");
        if (!response.ok) return;
        const data = (await response.json()) as LeaderboardResult;
        if (!cancelled) setPublicLeaderboard(data);
      } catch {
        // Leaderboard section keeps its static copy.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const liveFaqGroups: FaqGroup[] =
    publicContent && publicContent.faqs.length > 0 ? groupFaqs(publicContent.faqs) : (faqGroups as FaqGroup[]);

  // Keep the active FAQ tab valid when CMS content changes.
  const resolvedFaqGroupId = liveFaqGroups.some((group) => group.id === activeGroup)
    ? activeGroup
    : liveFaqGroups[0]?.id ?? activeGroup;

  const enterExperience = () => {
    if (entryPhase !== "intro") return;
    const AudioContextConstructor = window.AudioContext;
    if (AudioContextConstructor && !audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }
    const audio = audioContextRef.current;
    if (audio?.state === "suspended") void audio.resume().catch(() => {});
    setEntryPhase("done");
  };

  useEffect(() => {
    if (!entryOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [entryOpen]);

  useEffect(() => {
    const canvas = dustCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    type DustParticle = {
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      startAt: number;
      duration: number;
      arcX: number;
      arcY: number;
      size: number;
      color: string;
      burst?: boolean;
    };

    const particles: DustParticle[] = [];
    const completionTimers: number[] = [];
    const colors = ["#b9f267", "#d3ba70", "#e6edce", "#86c657"];
    let width = window.innerWidth;
    let height = window.innerHeight;
    let frame = 0;

    const playRevealSound = () => {
      const audio = audioContextRef.current;
      const now = performance.now();
      if (!audio || audio.state !== "running" || now - lastRevealSoundAtRef.current < 180) return;
      lastRevealSoundAtRef.current = now;

      const startAt = audio.currentTime;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(620, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(470, startAt + 0.075);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.008, startAt + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.085);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.09);
    };

    const resizeCanvas = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const drawParticles = (now: number) => {
      context.clearRect(0, 0, width, height);
      const activeParticles: DustParticle[] = [];

      particles.forEach((particle) => {
        if (now < particle.startAt) {
          activeParticles.push(particle);
          return;
        }

        const progress = Math.min(1, (now - particle.startAt) / particle.duration);
        const eased = progress < 0.5
          ? 4 * progress ** 3
          : 1 - ((-2 * progress + 2) ** 3) / 2;
        const curve = Math.sin(progress * Math.PI);
        const x = particle.fromX + (particle.toX - particle.fromX) * eased + particle.arcX * curve;
        const y = particle.fromY + (particle.toY - particle.fromY) * eased + particle.arcY * curve;
        const opacity = particle.burst
          ? (progress < 0.12 ? progress / 0.12 : (1 - progress) / 0.88)
          : (progress < 0.68 ? Math.min(1, progress / 0.16) : 1 - (progress - 0.68) / 0.32);

        context.globalAlpha = Math.max(0, opacity) * 0.9;
        context.fillStyle = particle.color;
        context.shadowColor = particle.color;
        context.shadowBlur = particle.size * (particle.burst ? 9 : 5);
        context.beginPath();
        context.arc(x, y, particle.size * (particle.burst ? 1.15 : 1), 0, Math.PI * 2);
        context.fill();

        if (progress < 1) activeParticles.push(particle);
      });

      context.globalAlpha = 1;
      context.shadowBlur = 0;
      particles.length = 0;
      activeParticles.forEach((particle) => particles.push(particle));
      if (particles.length) frame = window.requestAnimationFrame(drawParticles);
      else frame = 0;
    };

    const cards = document.querySelectorAll<HTMLElement>(
      ".program-layout, .journey-title, .benefits-title, .benefits-intro, .benefit-icons-grid li, .missions-head, .mission-list li, .leaderboard-head, .leaderboard-note, .faq-heading, .faq-layout, .join-content"
    );
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const card = entry.target as HTMLElement;
        const rect = card.getBoundingClientRect();
        const now = performance.now();
        const delay = Number(card.dataset.dustDelay || 0);
        card.classList.add("dust-visible");
        playRevealSound();

        const finishTimer = window.setTimeout(() => {
          card.classList.add("dust-finished");
          window.setTimeout(() => card.classList.remove("dust-finished"), 650);
        }, 1300 + delay);
        completionTimers.push(finishTimer);

        for (let index = 0; index < 74; index += 1) {
          const endX = rect.left + Math.random() * rect.width;
          const endY = rect.top + Math.random() * rect.height;
          const scatterX = rect.width * (0.08 + Math.random() * 0.18);
          const scatterY = rect.height * (0.08 + Math.random() * 0.18);
          particles.push({
            fromX: Math.max(rect.left - 5, Math.min(rect.right + 5, endX + (Math.random() - 0.5) * scatterX * 2)),
            fromY: Math.max(rect.top - 5, Math.min(rect.bottom + 5, endY + (Math.random() - 0.5) * scatterY * 2)),
            toX: endX,
            toY: endY,
            startAt: now + delay + Math.random() * 160,
            duration: 900 + Math.random() * 420,
            arcX: (Math.random() - 0.5) * 12,
            arcY: (Math.random() - 0.5) * 12,
            size: 0.75 + Math.random() * 1.45,
            color: colors[Math.floor(Math.random() * colors.length)],
          });
        }

        for (let index = 0; index < 32; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          const distance = 12 + Math.random() * 28;
          const fromX = rect.left + Math.random() * rect.width;
          const fromY = rect.top + Math.random() * rect.height;
          particles.push({
            fromX,
            fromY,
            toX: fromX + Math.cos(angle) * distance,
            toY: fromY + Math.sin(angle) * distance,
            startAt: now + delay + 1280 + Math.random() * 90,
            duration: 330 + Math.random() * 220,
            arcX: 0,
            arcY: 0,
            size: 1.1 + Math.random() * 1.8,
            color: colors[Math.floor(Math.random() * colors.length)],
            burst: true,
          });
        }

        if (!frame) frame = window.requestAnimationFrame(drawParticles);
        observer.unobserve(card);
      });
    }, { threshold: 0.16, rootMargin: "0px 0px -5% 0px" });

    cards.forEach((card, index) => {
      card.classList.add("dust-reveal");
      card.dataset.dustDelay = String((index % 4) * 85);
      card.style.setProperty("--dust-delay", `${(index % 4) * 85}ms`);
      observer.observe(card);
    });

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resizeCanvas);
      completionTimers.forEach((timer) => window.clearTimeout(timer));
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

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

  const currentGroup = liveFaqGroups.find((group) => group.id === resolvedFaqGroupId) ?? liveFaqGroups[0] ?? faqGroups[0];

  return (
    <main className="site-shell">
      <canvas ref={dustCanvasRef} className="dust-particle-canvas" aria-hidden="true" />
      {entryOpen && <section className={`entry-screen${entryPhase !== "intro" ? " is-cinematic" : ""}${entryPhase === "ignition" ? " is-igniting" : ""}${entryPhase === "fracture" ? " is-fracturing" : ""}`} role="dialog" aria-modal="true" aria-label="Welcome to Campus Assembly">
        <Image src="/images/cap-entry-background.png" alt="" fill sizes="100vw" priority className="entry-backdrop-photo" />
        {entryPhase !== "intro" && <div className={`entry-impact${entryPhase === "ignition" ? " is-live" : ""}`} aria-hidden="true" />}
        {entryPhase !== "intro" && <svg className={`entry-fracture-lines${entryPhase === "fracture" ? " is-breaking" : ""}`} viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
          <path className="entry-crack" pathLength={1} d="M500 350 L420 315 L340 336 L200 273 L100 315 L0 308" />
          <path className="entry-crack" pathLength={1} d="M500 350 L540 329 L610 294 L720 245 L820 154 L1000 0" />
          <path className="entry-crack" pathLength={1} d="M500 350 L600 427 L660 476 L700 518 L840 588 L1000 700" />
          <path className="entry-crack" pathLength={1} d="M500 350 L390 427 L340 476 L270 504 L130 602 L0 700" />
          <path className="entry-crack" pathLength={1} d="M398 302 L390 269 L365 248 L374 216 L350 185 L361 154 L339 123 L347 92 L327 60" />
          <path className="entry-crack" pathLength={1} d="M609 304 L618 270 L642 249 L633 216 L657 185 L647 154 L669 123 L661 92 L681 60" />
          <path className="entry-crack" pathLength={1} d="M420 478 L389 487 L375 515 L341 510 L315 535 L281 529 L256 557 L220 550 L194 578 L158 571 L129 600 L91 593 L62 622" />
          <path className="entry-crack" pathLength={1} d="M582 480 L613 489 L628 517 L661 511 L687 537 L721 531 L746 559 L781 552 L808 580 L844 573 L873 602 L910 595 L940 624" />
        </svg>}
        {entryPhase === "fracture" && <div className="entry-shards" aria-hidden="true"><span className="entry-shard entry-shard-north" /><span className="entry-shard entry-shard-east" /><span className="entry-shard entry-shard-south" /><span className="entry-shard entry-shard-west" /></div>}
        <div className="entry-flag-motion" aria-hidden="true"><span className="entry-flag entry-flag-left" /><span className="entry-flag entry-flag-right" /></div>
        <div className="entry-fire-glows" aria-hidden="true"><span className="entry-fire-glow entry-fire-glow-1" /><span className="entry-fire-glow entry-fire-glow-2" /><span className="entry-fire-glow entry-fire-glow-3" /><span className="entry-fire-glow entry-fire-glow-4" /></div>
        <div className="entry-vignette" aria-hidden="true" />
        <div className="entry-brand"><HexMark /><span>CAMPUS ASSEMBLY<small>INITIATIVE / 2026</small></span></div>
        <div className="entry-center">
          <span className="entry-overline">YOUR CAMPUS. YOUR FRONTIER.</span>
          <button className="entry-button" type="button" autoFocus disabled={entryPhase !== "intro"} onClick={enterExperience}>
            <span className="entry-button-ring"><span>✦</span></span>
            <span className="entry-button-label">TAP TO ENTER</span>
          </button>
        </div>
        <span className="entry-coordinate entry-coordinate-left">EARTH-616 / CAP</span>
        <span className="entry-coordinate entry-coordinate-right">EST. 2026</span>
      </section>}
      <div className="worldtree-background" aria-hidden="true" ref={worldtreeRef}>
        <Image src="/images/multiverse-canopy-hq.png" alt="" fill sizes="100vw" quality={90} className="worldtree-image" />
        <div className="worldtree-shade" />
        <Image src="/images/doom-hero.png" alt="" width={1024} height={1536} sizes="(max-width: 640px) 100vw, 68vw" className="worldtree-mask" />
      </div>
      <div className="site-content" data-launching={entryPhase === "intro" || entryPhase === "ignition" ? "true" : "false"} data-launch-reveal={entryPhase === "fracture" ? "true" : "false"} inert={entryOpen}>
      <header className="site-header">
        <a className="brand header-brand" href="#top" aria-label="Campus Assembly, E-Cell IIT BHU"><ECellLogo /><span className="brand-divider" aria-hidden="true" /><span className="brand-name">CAMPUS ASSEMBLY<span className="brand-sub">INITIATIVE  /  2026</span></span></a>
        <button className="menu-toggle" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? "×" : "☰"}</button>
        <nav className={menuOpen ? "main-nav nav-open" : "main-nav"} aria-label="Main navigation" onClick={() => setMenuOpen(false)}>
          <a href="#about">ABOUT CAP</a><a href="#journey">HOW IT WORKS</a><a href="#missions">WHAT YOU’LL DO</a><a href="#faq">FAQ</a>
          <a className="nav-join" href="#join">APPLICATIONS <Arrow diagonal /></a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-orbit orbit-one" aria-hidden="true" /><div className="hero-orbit orbit-two" aria-hidden="true" />
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> CAMPUS AMBASSADOR PROGRAM <span className="eyebrow-index">[ EARTH-616 / CAP ]</span></div>
          <h1 aria-label="THE FUTURE IS ASSEMBLED"><span className="hero-title-line"><AssembleLetters text="THE FUTURE" /></span><span className="hero-title-line"><AssembleLetters text="IS" delay={380} /></span><span className="hero-title-line"><span className="hero-title-accent"><AssembleLetters text="ASSEMBLED" delay={455} /></span></span></h1>
          <p className="hero-tagline">CAMPUS AMBASSADOR PROGRAM</p>
          <p className="hero-description"><span className="hero-description-highlight">CAP helps students bring entrepreneurship activities to their campus through outreach, content, events and quizzes.</span></p>
          <div className="hero-actions"><a className="button button-primary" href="#join">APPLICATION DETAILS <Arrow diagonal /></a><a className="button button-ghost" href="#about">WHAT IS CAP? <span>↓</span></a></div>
          <div className="hero-caption"><span className="caption-mark">✳</span><span>FOR THE ONES WHO<br />MOVE THEIR WORLD.</span><span className="caption-rule" /><span className="caption-coordinate">19°04&apos; N / 72°52&apos; E</span></div>
        </div>
        <div className="hero-bottom"><span>SCROLL TO EXPLORE <b>↓</b></span><span>NO. 001 <i>—</i> CAMPUS OPERATIONS</span><span>INDEPENDENT FAN INITIATIVE <i>✳</i></span></div>
      </section>

      <div className="signal-strip"><div className="signal-track"><div className="signal-group"><span>ONE CAMPUS AT A TIME</span><b>✳</b><span>IDEAS INTO ACTION</span><b>✳</b><span>YOUR WORLD NEEDS YOU</span><b>✳</b></div><div className="signal-group" aria-hidden="true"><span>ONE CAMPUS AT A TIME</span><b>✳</b><span>IDEAS INTO ACTION</span><b>✳</b><span>YOUR WORLD NEEDS YOU</span><b>✳</b></div></div></div>

      <section className="section program-section" id="about">
        <div className="section-kicker"><span>01 / ABOUT THE PROGRAM</span><span>THE BASICS</span></div>
        <div className="program-layout about-intro">
          <p className="overline">CAMPUS AMBASSADOR PROGRAM</p>
          <h2>What is <em>CAP?</em></h2>
          <div className="program-intro"><p>CAP is a student ambassador program that helps bring entrepreneurship activities to more college campuses. Ambassadors take part in outreach, create content, support events and complete quizzes. Participants can submit their work, receive feedback and track their progress.</p><a className="text-link" href="#journey">HOW THE PROGRAM WORKS <Arrow /></a></div>
        </div>
      </section>

      <section className="journey-section" id="journey">
        <div className="section journey-inner">
          <div className="section-kicker"><span>02 / HOW IT WORKS</span><span>YOUR PARTICIPATION</span></div>
          <div className="journey-title"><div><p className="overline">FROM SIGN-UP TO SUBMISSION</p><h2>How CAP <em>works</em></h2></div></div>
          <div className="journey-explorer" onMouseLeave={() => setActiveJourneyStep(null)}>
            <div className="journey-stones" role="group" aria-label="Steps in the CAP program" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", position: "relative", marginTop: 34 }}>
              {journeySteps.map((step, index) => {
                const isActive = activeJourneyStep === step.id;
                const stone = journeyStonePalette[step.color as keyof typeof journeyStonePalette];
                return <button key={step.id} type="button" className={`journey-stone journey-stone-${step.color}${isActive ? " is-active" : ""}`} aria-pressed={isActive} onMouseEnter={() => setActiveJourneyStep(step.id)} onFocus={() => setActiveJourneyStep(step.id)} onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setActiveJourneyStep(null); }} onClick={() => setActiveJourneyStep(step.id)} style={{ position: "relative", zIndex: 1, display: "flex", minWidth: 0, minHeight: 112, flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 8, padding: "0 8px 14px", border: 0, background: "transparent", color: isActive ? "#fff" : "#d8d0c2", cursor: "pointer", textShadow: isActive ? `0 0 15px ${stone.glow}` : "none" }}>
                  <JourneyGem id={step.id} color={step.color as keyof typeof journeyStonePalette} active={isActive} />
                  <span className="journey-stone-number" style={{ color: stone.color, font: "700 10px/1 monospace", letterSpacing: ".14em" }}>0{index + 1}</span>
                  <span className="journey-stone-title" style={{ color: isActive ? "#fff" : stone.color, fontSize: 14, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{step.title}</span>
                </button>;
              })}
            </div>
            <div className="journey-reveal" aria-live="polite" aria-atomic="true" style={{ minHeight: activeJourneyStep ? 154 : 0, display: "flex", alignItems: "flex-start", justifyContent: "center", margin: activeJourneyStep ? "10px auto 0" : "0 auto", padding: activeJourneyStep ? "0 0 20px" : 0 }}>
              {journeySteps.filter((step) => step.id === activeJourneyStep).map((step) => {
                const stone = journeyStonePalette[step.color as keyof typeof journeyStonePalette];
                return <article key={step.id} className={`journey-reveal-content journey-reveal-${step.color}`} style={{ width: "min(820px, 100%)", padding: "21px 28px 24px", borderTop: `1px solid ${stone.color}a8`, borderBottom: `1px solid ${stone.color}66`, background: `linear-gradient(90deg, ${stone.glow}1f, transparent 78%)`, boxShadow: `0 12px 35px -25px ${stone.glow}`, animation: "journey-step-in .22s ease-out both" }}><span className="journey-reveal-index" style={{ color: stone.color, font: "700 10px/1 monospace", letterSpacing: ".18em" }}>STEP {String(journeySteps.findIndex((item) => item.id === step.id) + 1).padStart(2, "0")}</span><h3 style={{ margin: "8px 0", color: "#f3eee4", fontSize: "clamp(21px, 2.5vw, 30px)", textShadow: `0 0 18px ${stone.glow}99` }}>{step.heading}</h3><p style={{ margin: 0, color: "#d8d1c1", fontSize: 16, lineHeight: 1.7 }}>{step.copy}</p></article>;
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="section benefits-section" id="benefits"><div className="section-kicker"><span>03 / WHAT YOU CAN GAIN</span><span>SKILLS THROUGH PRACTICE</span></div><div className="benefits-title"><p className="overline">A CAMPUS ROLE. PRACTICAL EXPERIENCE.</p><h2>What&apos;s <em>in it</em><br />for you?</h2></div><p className="benefits-intro">Take part in entrepreneurship on your campus and get access to experiences, resources and recognition through CAP.</p><BenefitCards /></section>

      <section className="missions-section" id="missions"><div className="section missions-inner"><div className="section-kicker"><span>04 / PROGRAM TASKS</span><span>WHAT PARTICIPANTS DO</span></div><div className="missions-head"><div><p className="overline">TYPICAL TASK AREAS</p><h2>Ways to <em>take part.</em></h2></div></div><ul className="mission-list">
        <li><button className="mission-flip" type="button" aria-label="Campus outreach. Help students hear about entrepreneurship activities, competitions and events."><span className="mission-flip-inner" aria-hidden="true"><span className="mission-flip-face mission-flip-front"><span className="mission-flip-title">Campus outreach</span></span><span className="mission-flip-face mission-flip-back"><span className="mission-flip-description">Help students hear about entrepreneurship activities, competitions and events.</span></span></span></button></li>
        <li><button className="mission-flip" type="button" aria-label="Content and promotion. Share useful information and create content that encourages student participation."><span className="mission-flip-inner" aria-hidden="true"><span className="mission-flip-face mission-flip-front"><span className="mission-flip-title">Content and promotion</span></span><span className="mission-flip-face mission-flip-back"><span className="mission-flip-description">Share useful information and create content that encourages student participation.</span></span></span></button></li>
        <li><button className="mission-flip" type="button" aria-label="Event support. Help coordinate or promote campus activities, with support from the program team."><span className="mission-flip-inner" aria-hidden="true"><span className="mission-flip-face mission-flip-front"><span className="mission-flip-title">Event support</span></span><span className="mission-flip-face mission-flip-back"><span className="mission-flip-description">Help coordinate or promote campus activities, with support from the program team.</span></span></span></button></li>
        <li><button className="mission-flip" type="button" aria-label="Quizzes and submissions. Complete in-site quizzes and submit task evidence through a public Drive link."><span className="mission-flip-inner" aria-hidden="true"><span className="mission-flip-face mission-flip-front"><span className="mission-flip-title">Quizzes and submissions</span></span><span className="mission-flip-face mission-flip-back"><span className="mission-flip-description">Complete in-site quizzes and submit task evidence through a public Drive link.</span></span></span></button></li>
      </ul><p className="program-note">The exact task schedule, deadlines and scoring rules will be shared before tasks begin.</p></div></section>

      <section className="section leaderboard-section" id="leaderboard"><div className="section-kicker"><span>05 / PROGRESS AND RANKINGS</span><span>HOW POINTS WORK</span></div><div className="leaderboard-head"><div><p className="overline">TRACK YOUR PARTICIPATION</p><h2>See your<br /><em>progress.</em></h2></div><p>Reviewers score task submissions up to the points available for each task. Your final points determine your place on the leaderboard. The first rankings will appear when missions begin.</p></div><p className="leaderboard-note">Participants can see their own submission status and feedback. Public rankings display only the information shared with participants.</p>{publicLeaderboard && publicLeaderboard.entries.length > 0 ? <div style={{ marginTop: 22, border: "1px solid #2c3a45", borderRadius: 10, overflow: "hidden", background: "#0d151b" }}><div style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", borderBottom: "1px solid #22303a", font: "700 10px/1 monospace", letterSpacing: ".14em", color: "#9fb0bd" }}><span>LIVE RANKINGS</span><span>{publicLeaderboard.state.status.toUpperCase()}</span></div><ol style={{ listStyle: "none", margin: 0, padding: 0 }}>{publicLeaderboard.entries.slice(0, 5).map((entry) => <li key={entry.participantId} style={{ display: "grid", gridTemplateColumns: "48px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #1b2730", color: "#d8d1c1", fontSize: 14 }}><span style={{ font: "700 12px/1 monospace", color: "#d3ba70" }}>#{entry.rank}</span><span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}<small style={{ display: "block", color: "#8d9aa5", fontSize: 11 }}>{entry.college}</small></span><b style={{ color: "#b9f267", font: "700 13px/1 monospace" }}>{entry.totalPoints} pts</b></li>)}</ol></div> : null}</section>

      <section className="faq-section" id="faq" ref={faqRef}><div className="section"><div className="section-kicker"><span>06 / FIELD INTEL</span><span>{String(liveFaqGroups.reduce((total, group) => total + group.questions.length, 0))} QUESTIONS / {String(liveFaqGroups.length).padStart(2, "0")} CHANNELS</span></div><div className="faq-heading"><div><p className="overline">BEFORE YOU SUIT UP</p><h2>GOOD QUESTIONS.<br /><em>STRAIGHT ANSWERS.</em></h2></div><p>Clarity is a superpower. Find the signal before you join the mission.</p></div><div className="faq-layout"><div className="faq-tabs" role="tablist" aria-label="FAQ categories">{liveFaqGroups.map((group, index) => <button className={currentGroup.id === group.id ? "faq-tab active" : "faq-tab"} role="tab" aria-selected={currentGroup.id === group.id} aria-controls="faq-panel" id={`tab-${group.id}`} onClick={() => {setActiveGroup(group.id); setOpenQuestions([`${group.id}-0`]);}} key={group.id}><span>0{index + 1}</span>{group.label}<Arrow /></button>)}</div><div className="faq-panel" id="faq-panel" role="tabpanel" aria-labelledby={`tab-${currentGroup.id}`}>{currentGroup.questions.map(([question, answer], index) => {const key = `${currentGroup.id}-${index}`; const isOpen = openQuestions.includes(key); return <article className={isOpen ? "faq-item faq-open" : "faq-item"} id={`faq-${currentGroup.id}-${index + 1}`} key={key}><button className="faq-question" id={`question-${key}`} aria-expanded={isOpen} aria-controls={`answer-${key}`} onClick={() => toggleQuestion(key)} onKeyDown={(event) => moveFaqFocus(event, index, currentGroup.questions.length)}><span className="faq-q-index">Q{String(liveFaqGroups.flatMap((item) => item.questions).findIndex((item) => item[0] === question) + 1).padStart(2, "0")}</span><span>{question}</span><span className="faq-plus" aria-hidden="true">{isOpen ? "−" : "+"}</span></button><div className="faq-answer" id={`answer-${key}`} role="region" aria-labelledby={`question-${key}`} hidden={!isOpen}><p>{answer}</p></div></article>;})}</div></div></div></section>

      <section className="join-section" id="join"><div className="section join-inner"><div className="section-kicker"><span>07 / APPLICATIONS</span><span>DETAILS TO BE ANNOUNCED</span></div><div className="join-content"><div><p className="overline">INTERESTED IN JOINING?</p><h2>Applications<br /><em>coming soon.</em></h2><p className="join-copy">Eligibility, dates and application instructions will be published here once confirmed.</p><a className="button button-primary" href="#about">REVIEW THE PROGRAM <Arrow /></a></div><div className="application-details"><h3>Before applications open</h3><p>We’ll share eligibility, time commitment, program dates, selection steps and any confirmed benefits here.</p><a className="text-link" href="#faq">READ COMMON QUESTIONS <Arrow /></a></div></div></div></section>

      <footer className="site-footer"><div className="footer-top"><a className="brand" href="#top"><HexMark /><span className="brand-name">CAMPUS<span>·</span> ASSEMBLY<span className="brand-sub">INITIATIVE  /  2026</span></span></a><p>Built by fans. Powered by campus spirit.<br />An independent fan-made initiative.</p><a className="back-top" href="#top">BACK TO TOP ↑</a></div><div className="footer-bottom"><span>© CAP / CAMPUS OPERATIONS</span><span>UNOFFICIAL FAN-MADE PROJECT. NOT AFFILIATED WITH MARVEL STUDIOS OR THE WALT DISNEY COMPANY.</span><span>EARTH-616 <i>✳</i></span></div></footer>
      </div>
    </main>
  );
}
