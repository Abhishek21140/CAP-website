import type {
  AnnouncementItem,
  BenefitItem,
  FaqItem,
  MilestoneItem,
  ProgramInfoItem,
  TestimonialItem,
} from "@/lib/repositories/types";

export interface CmsSeedData {
  faqs: FaqItem[];
  benefits: BenefitItem[];
  programInfo: Record<string, ProgramInfoItem>;
  milestones: MilestoneItem[];
  testimonials: TestimonialItem[];
  announcements: AnnouncementItem[];
}

/**
 * Seed content for the no-code CMS (PRD §6.1 H / §6.2 H).
 *
 * Mirrors the copy that previously lived inline in `app/page.tsx`, so the public
 * site renders identically whether it reads from the API or the static fallback.
 * Anything unconfirmed by the CAP team is stored as a placeholder / draft.
 */
export function getCmsSeedData(): CmsSeedData {
  const now = new Date().toISOString();

  const faqEntries: Array<{ group: string; question: string; answer: string; requiresConfirmation?: boolean }> = [
    {
      group: "about",
      question: "What is the Campus Ambassador Program?",
      answer:
        "Students represent the organisation on campus, complete missions across promotion, content, events and quizzes, and earn points that shape their place on a live leaderboard.",
    },
    {
      group: "about",
      question: "Who is eligible to apply?",
      answer: "Eligibility will be announced by the CAP team.",
      requiresConfirmation: true,
    },
    {
      group: "about",
      question: "How does the application and selection process work?",
      answer:
        "The journey starts with registration and email verification. Whether access is immediate or approval-based, along with the selection criteria and result date, will be announced.",
      requiresConfirmation: true,
    },
    {
      group: "about",
      question: "Is this an internship or a campus ambassador role?",
      answer: "CAP is a campus ambassador program. Its formal classification will be confirmed by CAP leadership.",
      requiresConfirmation: true,
    },
    {
      group: "benefits",
      question: "What will participants gain?",
      answer:
        "Build experience through real campus tasks, reviewer feedback and a transparent view of points and rank. Any rewards or recognition will be listed only after confirmation; no outcome is guaranteed.",
    },
    {
      group: "benefits",
      question: "What practical skills and experience can participants develop?",
      answer:
        "Tasks offer opportunities to practise communication, outreach, promotion, content creation, event coordination, teamwork and leadership. Your experience depends on your participation.",
    },
    {
      group: "benefits",
      question: "Are there monetary rewards, a stipend or other financial benefits?",
      answer:
        "No monetary reward, stipend or financial benefit is promised at this time. Any confirmed rewards will be listed here.",
    },
    {
      group: "benefits",
      question: "Is there any registration fee?",
      answer: "Fee details will be confirmed before registration opens.",
      requiresConfirmation: true,
    },
    {
      group: "benefits",
      question: "Will participants receive certificates or letters of recommendation?",
      answer: "Not promised. Any certificate or recommendation, and who qualifies, will be announced if confirmed.",
      requiresConfirmation: true,
    },
    {
      group: "benefits",
      question: "Are internship opportunities or referrals available?",
      answer: "No internship or referral is promised.",
    },
    {
      group: "tasks",
      question: "How much time must participants commit each week?",
      answer: "To be announced.",
      requiresConfirmation: true,
    },
    {
      group: "tasks",
      question: "What tasks will ambassadors perform?",
      answer:
        "Missions may include promotion, content, events and quizzes. Most tasks use a public Google Drive link as proof; quizzes are completed on the site. Weekly task count: To be announced.",
    },
    {
      group: "tasks",
      question: "Can students participate alongside regular studies?",
      answer:
        "The program is intended to run alongside classes. Weekly hours, peak weeks and fixed IST deadlines will be shared when confirmed. No academic accommodation is promised.",
      requiresConfirmation: true,
    },
    {
      group: "points",
      question: "How are points awarded and rankings calculated?",
      answer:
        "Reviewers award points up to each task's maximum. Any approved late penalty is deducted from that score, with a floor of zero. Rankings use final points. Tie-break details will be shared with participants.",
    },
    {
      group: "points",
      question: "What happens if I miss a deadline?",
      answer:
        "After the approved grace period, a penalty may apply for each started 24 hours until the cutoff. After the cutoff, submissions lock. Quizzes close at their hard cutoff. Final values will be published before tasks open.",
    },
    {
      group: "points",
      question: "Can I resubmit or request an extension?",
      answer:
        "You can resubmit before the deadline, or after a reviewer requests changes. Resubmission does not reset a late penalty. Extensions are granted by admins; the request process will be announced.",
    },
    {
      group: "updates",
      question: "How will selected participants receive updates?",
      answer:
        "Tasks, review status, feedback and results will appear on the dashboard. Approved announcements will appear here. Reminder channels are still to be announced.",
      requiresConfirmation: true,
    },
    {
      group: "updates",
      question: "Whom can participants contact for assistance?",
      answer: "Support contact details will be announced by the CAP team.",
      requiresConfirmation: true,
    },
  ];

  const faqs: FaqItem[] = faqEntries.map((entry, index) => ({
    id: `faq-${String(index + 1).padStart(2, "0")}`,
    group: entry.group,
    question: entry.question,
    answer: entry.answer,
    displayOrder: index + 1,
    status: "published",
    requiresConfirmation: entry.requiresConfirmation ?? false,
    confirmedBy: null,
    confirmedAt: null,
    updatedBy: null,
    updatedAt: now,
  }));

  const benefitEntries: Array<{ icon: string; title: string; description: string; tier: BenefitItem["tier"] }> = [
    { icon: "pass", title: "Free E-Summit 2026 passes", description: "Attend E-Summit and take part in the entrepreneurship conversations.", tier: "included" },
    { icon: "percent", title: "Meet startup founders", description: "Network with founders and learn from their experience.", tier: "experience" },
    { icon: "learning", title: "One-to-one mentorship", description: "Get mentorship from startup founders.", tier: "merit_based" },
    { icon: "profile", title: "Get featured", description: "Top performers may be featured on E-Cell IIT BHU social media.", tier: "merit_based" },
    { icon: "video", title: "Entrepreneurship Masterclass", description: "Access sessions focused on the startup journey.", tier: "experience" },
    { icon: "medal", title: "BWU Cohort opportunity", description: "Top participants can get an opportunity to enter the BWU Cohort and begin their entrepreneurship journey.", tier: "merit_based" },
    { icon: "book", title: "Startup Helpbook", description: "Access E-Cell IIT BHU's curated guide to starting up.", tier: "included" },
    { icon: "ticket", title: "Newsletter feature", description: "Top Campus Ambassadors may be featured in E-Cell IIT BHU's weekly newsletter.", tier: "merit_based" },
    { icon: "certificate", title: "Internship certificate", description: "Receive a certificate of internship verified by E-Cell IIT BHU.", tier: "merit_based" },
    { icon: "merch", title: "Sponsor goodies and resources", description: "Get goodies, merchandise and learning resources from sponsors.", tier: "included" },
  ];

  const benefits: BenefitItem[] = benefitEntries.map((entry, index) => ({
    id: `benefit-${String(index + 1).padStart(2, "0")}`,
    title: entry.title,
    description: entry.description,
    icon: entry.icon,
    tier: entry.tier,
    displayOrder: index + 1,
    status: "published",
    requiresConfirmation: false,
    confirmedBy: null,
    confirmedAt: null,
  }));

  const programInfo: Record<string, ProgramInfoItem> = {
    duration: { key: "duration", value: "To be announced", status: "placeholder", confirmedBy: null, confirmedAt: null, updatedAt: now },
    hours_per_week: { key: "hours_per_week", value: "To be announced", status: "placeholder", confirmedBy: null, confirmedAt: null, updatedAt: now },
    tasks_per_week: { key: "tasks_per_week", value: "To be announced", status: "placeholder", confirmedBy: null, confirmedAt: null, updatedAt: now },
    eligibility: { key: "eligibility", value: "To be announced", status: "placeholder", confirmedBy: null, confirmedAt: null, updatedAt: now },
    rewards: { key: "rewards", value: "No monetary reward is promised at this time.", status: "placeholder", confirmedBy: null, confirmedAt: null, updatedAt: now },
    contact: { key: "contact", value: "Support contact details will be announced by the CAP team.", status: "placeholder", confirmedBy: null, confirmedAt: null, updatedAt: now },
  };

  const milestones: MilestoneItem[] = [
    { id: "milestone-01", label: "Applications open", phase: "Application", startDate: null, endDate: null, isPeak: false, displayOrder: 1, status: "published" },
    { id: "milestone-02", label: "Onboarding and task briefing", phase: "Onboarding", startDate: null, endDate: null, isPeak: false, displayOrder: 2, status: "published" },
    { id: "milestone-03", label: "Weekly missions", phase: "Active", startDate: null, endDate: null, isPeak: true, displayOrder: 3, status: "published" },
    { id: "milestone-04", label: "Final submissions and results", phase: "Closing", startDate: null, endDate: null, isPeak: true, displayOrder: 4, status: "published" },
  ];

  // No testimonials until written consent is recorded (PRD §6.1 I).
  const testimonials: TestimonialItem[] = [];

  const announcements: AnnouncementItem[] = [
    {
      id: "announcement-01",
      title: "Applications opening soon",
      body: "The Campus Ambassador Program is preparing to open applications. Eligibility, dates and task details will be published here once confirmed.",
      status: "published",
      publishFrom: null,
      publishTo: null,
      updatedBy: null,
      createdAt: now,
    },
  ];

  return { faqs, benefits, programInfo, milestones, testimonials, announcements };
}
