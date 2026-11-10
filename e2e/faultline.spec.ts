import AxeBuilder from "@axe-core/playwright";
import { expect, test as base } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

const test = base.extend<{ appPage: Page }, { appContext: BrowserContext }>({
  appContext: [
    async ({ browser }, provide) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      await provide(context);
      await context.close();
    },
    { scope: "worker" },
  ],
  appPage: async ({ appContext }, provide) => {
    const page = pages.get(appContext) ?? (await appContext.newPage());
    pages.set(appContext, page);
    await provide(page);
  },
});

const pages = new WeakMap<BrowserContext, Page>();

async function healthyNodeCount(page: Page): Promise<number> {
  const summary = await page.getByRole("region", { name: "Live system summary" }).innerText();
  const match = summary.match(/HEALTHY NODES\s*(\d+)/i);
  return match ? Number(match[1]) : 10;
}

test.describe("FAULTLINE production workflows", () => {
  test("1. landing page loads and mounts its 3D hero", async ({ appPage }) => {
    await appPage.goto("/");
    await expect(
      appPage.getByRole("heading", { name: /EVERY SYSTEM HAS A BREAKING POINT/i }),
    ).toBeVisible();
    await expect(
      appPage.getByRole("link", { name: /ENTER THE OBSERVATORY/i }).first(),
    ).toHaveAttribute("href", "/observatory");
    await expect(appPage.locator("canvas").first()).toBeVisible();
  });

  test("2. navigation reaches the product workspaces", async ({ appPage }) => {
    await appPage.goto("/about");
    await appPage.getByRole("link", { name: "Observatory", exact: true }).click();
    await expect(appPage).toHaveURL(/\/observatory$/);
    await expect(appPage.getByRole("heading", { name: /service observatory/i })).toBeVisible();
    await appPage.goto("/about");
    await appPage.getByRole("link", { name: "Architecture", exact: true }).click();
    await expect(appPage).toHaveURL(/\/architecture$/);
    await expect(appPage.getByRole("heading", { name: /Architecture Explorer/i })).toBeVisible();
  });

  test("3. observatory renders an interactive network canvas", async ({ appPage }) => {
    await appPage.goto("/observatory");
    await expect(
      appPage.getByRole("region", { name: /interactive 3d service topology/i }),
    ).toBeVisible();
    const canvas = appPage.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(100);
    expect(box?.height).toBeGreaterThan(100);
    const health = await appPage.request.get("/api/health");
    expect(health.ok()).toBe(true);
    await expect(health.json()).resolves.toMatchObject({
      status: "ok",
      database: "not_configured",
      mode: "demo",
    });
  });

  test("4. observatory starts the browser simulation", async ({ appPage }) => {
    await appPage.goto("/observatory");
    const start = appPage.getByRole("button", { name: "Start simulation" });
    await start.click();
    await expect(start).toHaveAttribute("aria-pressed", "true");
  });

  test("5. selecting a service updates the inspector", async ({ appPage }) => {
    await appPage.goto("/observatory");
    await appPage
      .getByRole("button", { name: /User Service/i })
      .first()
      .click();
    await expect(appPage.getByRole("heading", { name: "User Service" })).toBeVisible();
    await expect(appPage.getByRole("complementary", { name: "Service inspector" })).toContainText(
      "CPU",
    );
  });

  test("6. database failure is validated and injected into PostgreSQL", async ({ appPage }) => {
    await appPage.goto("/chaos-lab");
    await appPage.getByRole("button", { name: /Primary database outage/i }).click();
    await appPage.getByLabel("SCENARIO NAME").fill("E2E database outage");
    await appPage.getByRole("button", { name: /VALIDATE & RUN PREFLIGHT/i }).click();
    await expect(appPage.getByText("FAULT INJECTION READY")).toBeVisible();
    await appPage.getByRole("button", { name: /CONFIRM AND INJECT/i }).click();
    await expect(appPage.getByText("FAULT INJECTION ACTIVE")).toBeVisible();
    await expect.poll(() => healthyNodeCount(appPage), { timeout: 12_000 }).toBeLessThan(10);
    await expect(appPage.getByText(/FAILED REQS/i)).toBeVisible();
    await appPage.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(appPage.getByText(/RUN COMPLETE/i)).toBeVisible({ timeout: 20_000 });
  });

  test("7. cascading failures propagate to dependent services", async ({ appPage }) => {
    await appPage.getByRole("button", { name: "Reset", exact: true }).click();
    await appPage.getByRole("button", { name: /Cascading dependency failure/i }).click();
    await appPage.getByLabel("SCENARIO NAME").fill("E2E cascading failure");
    await appPage.getByRole("button", { name: /VALIDATE & RUN PREFLIGHT/i }).click();
    await appPage.getByRole("button", { name: /CONFIRM AND INJECT/i }).click();
    await expect(appPage.getByText("FAULT INJECTION ACTIVE")).toBeVisible();
    await expect.poll(() => healthyNodeCount(appPage), { timeout: 12_000 }).toBeLessThanOrEqual(6);
    await expect(appPage.getByText(/FAILED REQS/i)).toBeVisible();
    await appPage.getByRole("button", { name: "Stop", exact: true }).click();
  });

  test("8. recovery completes and returns affected services to the graph", async ({ appPage }) => {
    test.setTimeout(60_000);
    await expect(
      appPage.getByText(/completed recovery and rejoined the graph/i).first(),
    ).toBeVisible({ timeout: 45_000 });
    await expect(appPage.getByText(/RUN COMPLETE/i)).toBeVisible({ timeout: 45_000 });
  });

  test("9. completed experiments are recorded in the incident archive", async ({ appPage }) => {
    await appPage.goto("/incidents");
    await expect(appPage.getByText("E2E cascading failure").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(appPage.getByRole("region", { name: "Incident summary" })).toContainText(
      "RECORDED RUNS",
    );
  });

  test("10. recorded incidents can be replayed and seeked", async ({ appPage }) => {
    test.setTimeout(60_000);
    await appPage.goto("/incidents");
    await expect(
      appPage.getByRole("button", { name: /E2E cascading failure/i }).first(),
    ).toBeVisible();
    await expect(appPage.getByRole("button", { name: "Play replay" })).toBeEnabled();
    const timeline = appPage.getByRole("slider", { name: "Seek replay timeline" });
    const initialPosition = await timeline.inputValue();
    await appPage.getByRole("button", { name: "Next event" }).click({ timeout: 5_000 });
    await expect(timeline).not.toHaveValue(initialPosition, { timeout: 5_000 });
  });

  test("11. architecture components can be added and saved", async ({ appPage }) => {
    await appPage.goto("/architecture");
    await expect(appPage.getByRole("region", { name: "Architecture canvas" })).toBeVisible();
    await appPage.getByRole("button", { name: "External API EXT / MODULE" }).click();
    await expect(appPage.getByText(/ARCHITECTURE \/ 13 COMPONENTS/i)).toBeVisible();
    await appPage.getByRole("button", { name: "SAVE" }).click();
    await expect(
      appPage.getByRole("combobox", { name: "Select saved architecture" }),
    ).toContainText("E-commerce platform");
  });

  test("12. intelligence generates a PDF incident report from the recorded run", async ({
    appPage,
  }) => {
    test.setTimeout(60_000);
    await appPage.goto("/intelligence");
    await expect(appPage.getByText(/RECORDED RUN(?:S)?/i).first()).toBeVisible({
      timeout: 45_000,
    });
    await expect(appPage.getByRole("button", { name: "INCIDENT PDF" })).toBeEnabled({
      timeout: 10_000,
    });
    const downloadPromise = appPage.waitForEvent("download");
    await appPage.getByRole("button", { name: "INCIDENT PDF" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/faultline-.*\.pdf/i);
  });
});

for (const route of [
  "/",
  "/observatory",
  "/chaos-lab",
  "/incidents",
  "/architecture",
  "/intelligence",
  "/about",
]) {
  test(`accessibility: ${route} has no serious axe violations`, async ({ appPage }) => {
    test.setTimeout(60_000);
    await appPage.goto(route);
    const results = await new AxeBuilder({ page: appPage }).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(
      serious,
      `${route}: ${serious.map((item) => `${item.id} ${item.help}`).join("; ")}`,
    ).toEqual([]);
  });
}

test("responsive: observatory fits a narrow viewport without horizontal overflow", async ({
  appPage,
}) => {
  await appPage.setViewportSize({ width: 390, height: 844 });
  await appPage.goto("/observatory");
  await expect(appPage.getByRole("button", { name: "Open service inventory" })).toBeVisible();
  const dimensions = await appPage.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test("performance: records production route timing and client bundle size on desktop and mobile", async ({
  appPage,
}) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await appPage.setViewportSize(viewport);
    await appPage.goto("/");
    await expect(
      appPage.getByRole("heading", { name: /EVERY SYSTEM HAS A BREAKING POINT/i }),
    ).toBeVisible();
    const metrics = await appPage.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const paint = performance.getEntriesByType("paint");
      const staticBytes = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/_next/static/") && /\.js(?:\?|$)/.test(entry.name))
        .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).encodedBodySize, 0);
      return {
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
        loadEventMs: navigation?.loadEventEnd ?? null,
        firstContentfulPaintMs:
          paint.find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null,
        staticJavaScriptBytes: staticBytes,
      };
    });
    console.info(`[faultline perf ${viewport.width}px] ${JSON.stringify(metrics)}`);
    expect(metrics.loadEventMs).not.toBeNull();
    expect(metrics.loadEventMs!).toBeLessThan(12_000);
    expect(metrics.staticJavaScriptBytes).toBeLessThan(4_000_000);
  }
});
