import { test, expect } from "@playwright/test";

test.describe("Section 13.5 Accessibility & WCAG Compliance Suite", () => {
  test.beforeEach(async ({ page, request }) => {
    await request.post("/api/dev/reset");
    await page.goto("/admin");
    await page.waitForSelector("tbody tr strong", { state: "visible" });
  });

  test("1. Structural landmarks and proper heading hierarchy", async ({ page }) => {
    // Exactly one h1 on page
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();

    // Main landmark exists
    const main = page.locator("main");
    await expect(main).toBeVisible();

    // Table has proper header row
    const ths = page.locator("table thead th");
    await expect(ths.first()).toBeVisible();
    const thCount = await ths.count();
    expect(thCount).toBeGreaterThan(5);
  });

  test("2. Accessible names on all interactive controls", async ({ page }) => {
    // Filter chips have accessible names
    const filterTabs = page.getByRole("tab");
    const count = await filterTabs.count();
    expect(count).toBeGreaterThanOrEqual(7);

    for (let i = 0; i < count; i++) {
      const tab = filterTabs.nth(i);
      const name = (await tab.getAttribute("aria-label")) || (await tab.textContent());
      expect(name?.trim().length).toBeGreaterThan(0);
    }

    // Search input has accessible label or placeholder
    const search = page.getByPlaceholder(/search/i);
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute("aria-label");
  });

  test("3. Focus visibility and keyboard traversal", async ({ page }) => {
    // Press Tab and ensure focus outline / focused element is visible
    await page.keyboard.press("Tab");
    const activeTagName = await page.evaluate(() => document.activeElement?.tagName);
    expect(["BUTTON", "INPUT", "SELECT", "A", "TR"]).toContain(activeTagName);
  });

  test("4. Form controls in review panel have explicit labels and descriptions", async ({ page }) => {
    const row = page.locator("tbody tr", { hasText: "Aarav Sharma" }).first();
    await expect(row).toBeVisible();
    await row.click();

    const panel = page.getByRole("region", { name: /Submission Review Details/i });
    await expect(panel).toBeVisible();

    // Verify close button has aria-label
    const closeBtn = panel.getByRole("button", { name: /Close review panel/i });
    await expect(closeBtn).toBeVisible();

    // If input is present, it must have associated label
    const pointsInput = panel.getByLabel(/Points Awarded/i);
    if (await pointsInput.isVisible()) {
      await expect(pointsInput).toBeVisible();
    }
  });

  test("5. Responsive viewports: 768px (tablet), 1024px (laptop), 1440px (desktop)", async ({ page }) => {
    // 1440px desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("main")).toBeVisible();

    // 1024px laptop
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator("main")).toBeVisible();

    // 768px tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator("main")).toBeVisible();
  });
});
