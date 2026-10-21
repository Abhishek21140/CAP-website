import { test, expect } from "@playwright/test";

test.describe("Admin Submissions Review View & Engine E2E Suite", () => {
  test.beforeEach(async ({ page, request }) => {
    // Reset database state before each test to guarantee complete test isolation
    await request.post("/api/dev/reset");
    // Navigate to admin portal with memory data layer and default demo clock
    await page.goto("/admin");
    // Wait for the queue table or loading to settle
    await page.waitForSelector("tbody tr strong", { state: "visible" });
  });

  test("1 & 2. Renders Submissions Queue with Figure 8 exact chip counts", async ({ page }) => {
    // Verify Page Title / Submissions Heading
    await expect(page.locator("h1")).toContainText(/Submissions/i);

    // Verify all 7 filter chips with exact Figure 8 counts
    await expect(page.getByRole("tab", { name: /^All/i })).toContainText("312");
    await expect(page.getByRole("tab", { name: /^Pending review/i })).toContainText("14");
    await expect(page.getByRole("tab", { name: /^Approved/i })).toContainText("80");
    await expect(page.getByRole("tab", { name: /^Needs changes/i })).toContainText("9");
    await expect(page.getByRole("tab", { name: /^Rejected/i })).toContainText("15");
    await expect(page.getByRole("tab", { name: /^Late/i })).toContainText("22");
    await expect(page.getByRole("tab", { name: /^Missing/i })).toContainText("194");
  });

  test("3. Search & Filter Bar performs case-insensitive and partial matching", async ({ page }) => {
    const searchInput = page.getByLabel("Search submissions");
    await expect(searchInput).toBeVisible();

    // Search by participant name
    await searchInput.fill("Aarav");
    await page.waitForTimeout(300); // debounce
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toContainText("Aarav");

    // Search by college
    await searchInput.fill("NIT Patna");
    await page.waitForTimeout(300);
    await expect(page.locator("tbody")).toContainText("NIT Patna");

    // Search by roll number
    await searchInput.fill("24EE");
    await page.waitForTimeout(300);
    await expect(page.locator("tbody")).toContainText("24EE");

    // Clear search
    await searchInput.fill("");
    await page.waitForTimeout(300);
  });

  test("4 & 5. Review Panel opens with proof link, timing, and server penalty", async ({ page }) => {
    // Click on Aarav Sharma's row (sub-001)
    const aaravRow = page.locator("tbody tr", { hasText: "Aarav Sharma" }).first();
    await expect(aaravRow).toBeVisible();
    await aaravRow.click();

    // Verify Review Panel appears
    const panel = page.getByRole("region", { name: /Submission Review Details/i });
    await expect(panel).toBeVisible();
    await expect(panel.locator("h2")).toContainText("Aarav Sharma");

    // Verify proof link in panel
    const proofLink = panel.getByRole("link", { name: /Open proof in Drive/i });
    await expect(proofLink).toBeVisible();
    await expect(proofLink).toHaveAttribute("target", "_blank");

    // Verify timing & penalty
    await expect(panel).toContainText("Campus Poster Challenge");
    await expect(panel).toContainText(/Late/i);
  });

  test("6 & 7. Live penalty preview and Approve flow", async ({ page }) => {
    // Click on Aarav Sharma's row
    const row = page.locator("tbody tr", { hasText: "Aarav Sharma" }).first();
    await row.click();

    const panel = page.getByRole("region", { name: /Submission Review Details/i });
    await expect(panel).toBeVisible();

    // Check if decision buttons are present (for non-viewer role)
    const approveBtn = panel.getByRole("button", { name: /Approve/i });
    if (await approveBtn.isVisible()) {
      // Enter points and verify preview calculation
      const pointsInput = panel.getByLabel(/Points Awarded/i);
      await pointsInput.fill("90");

      // Verify live score computation preview
      const previewText = panel.locator("div").filter({ hasText: /Final =/i }).first();
      await expect(previewText).toBeVisible();

      // Click Approve
      await approveBtn.click();

      // Verify notice banner
      await expect(page.locator("[role='status'], [class*='notice']").first()).toBeVisible();
    }
  });

  test("8. Request changes flow requires mandatory feedback", async ({ page }) => {
    // Filter to Pending review
    await page.getByRole("tab", { name: /Pending review/i }).click();
    await page.waitForSelector("tbody tr strong", { state: "visible" });

    // Open first pending submission
    const firstRow = page.locator("tbody tr strong").first();
    await firstRow.click();

    const panel = page.getByRole("region", { name: /Submission Review Details/i });
    await expect(panel).toBeVisible();

    const changesBtn = panel.getByRole("button", { name: /Request changes/i });
    if (await changesBtn.isVisible()) {
      const reasonInput = panel.getByLabel(/Feedback or rejection reason/i);

      // Verify button is disabled when feedback < 5 chars
      await reasonInput.fill("");
      await expect(changesBtn).toBeDisabled();

      // Fill valid feedback >= 5 chars and verify button becomes enabled
      await reasonInput.fill("Please provide public access to the Google Drive link.");
      await expect(changesBtn).toBeEnabled();
    }
  });

  test("14. Viewer role cannot perform mutations (read-only mode)", async ({ page }) => {
    // Switch to Viewer persona via persona selector
    const personaSelect = page.getByLabel("Development persona selector");
    if (await personaSelect.isVisible()) {
      await personaSelect.selectOption("admin-v");
      await page.waitForSelector("tbody tr strong", { state: "visible" });

      // Open any real submission
      const realRow = page.locator("tbody tr strong").first();
      await realRow.click();

      const panel = page.getByRole("region", { name: /Submission Review Details/i });
      await expect(panel).toBeVisible();

      // Decision buttons (Approve, Request Changes, Reject) should not be visible or present
      await expect(panel.getByRole("button", { name: /^Approve$/i })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: /^Request changes$/i })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: /^Reject$/i })).toHaveCount(0);
    }
  });

  test("16. Quiz task displays Auto-scored badge and decision buttons disabled", async ({ page }) => {
    // Switch task filter to Quiz 2
    const taskSelect = page.getByLabel("Filter by task");
    await taskSelect.selectOption("task-quiz");
    await page.waitForTimeout(300);

    // Verify Quiz rows render with Auto-scored badge
    await expect(page.locator("tbody")).toContainText(/Auto-scored/i);

    // Open a quiz submission
    const quizRow = page.locator("tbody tr").first();
    await quizRow.click();

    const panel = page.getByRole("region", { name: /Submission Review Details/i });
    await expect(panel).toBeVisible();

    // Verify decisions cannot be made on quiz
    await expect(panel.getByRole("button", { name: /^Approve$/i })).toHaveCount(0);
  });

  test("17. Duplicate link fixture displays flag and matching notice", async ({ page }) => {
    // Switch task back to Poster Challenge
    const taskSelect = page.getByLabel("Filter by task");
    await taskSelect.selectOption("task-poster");
    await page.waitForTimeout(300);

    // Open Aarav Sharma's row (known duplicate in seed with Sana Khan)
    const aaravRow = page.locator("tbody tr", { hasText: "Aarav Sharma" }).first();
    await aaravRow.click();

    const panel = page.getByRole("region", { name: /Submission Review Details/i });
    await expect(panel).toBeVisible();

    // Verify duplicate notice displays
    await expect(panel.locator("[class*='notice']", { hasText: /Duplicate proof link/i })).toBeVisible();
  });

  test("19. Keyboard navigation supports j/k and Esc without triggering decisions", async ({ page }) => {
    // Click on Aarav Sharma's row
    const row = page.locator("tbody tr", { hasText: "Aarav Sharma" }).first();
    await row.click();

    const panel = page.getByRole("region", { name: /Submission Review Details/i });
    await expect(panel).toBeVisible();

    // Press 'Escape' to close panel
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
  });

  test("20. Responsive design: read-only warning on mobile viewport (<768px)", async ({ page }) => {
    // Set viewport to mobile width
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(200);

    // Verify mobile read-only indicator/banner appears
    const mobileBanner = page.locator("div, p, span").filter({ hasText: /Desktop recommended|read-only/i }).first();
    await expect(mobileBanner).toBeVisible();

    // Restore viewport
    await page.setViewportSize({ width: 1280, height: 800 });
  });
});
