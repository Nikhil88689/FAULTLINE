import { expect, test } from "@playwright/test";
import { makeIncidentFixture } from "../tests/fixtures/incident";

test("guest incident replay controls and PDF export use a complete stored record", async ({
  page,
}) => {
  const source = makeIncidentFixture();
  const fixture = makeIncidentFixture({
    simulationEndMs: 60_000,
    replayFrames: [{ ...source.replayFrames[0]!, nowMs: 0, eventSequence: 0 }],
    events: [{ type: "simulation.started", sequence: 1, atMs: 100 }],
  });
  await page.addInitScript((record) => {
    localStorage.setItem("faultline.incidents.v1", JSON.stringify([record]));
  }, fixture);

  await page.goto("/incidents");
  await expect(
    page.getByRole("button", { name: /Database outage resilience check/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Play replay" })).toBeEnabled();
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect(page.getByRole("button", { name: "Pause replay" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Pause replay" }).press("Space");
  await expect(page.getByRole("button", { name: "Play replay" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.goto("/intelligence");
  const report = page.getByRole("button", { name: "INCIDENT PDF" });
  await expect(report).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await report.focus();
  await page.keyboard.press("Enter");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/faultline-.*\.pdf/i);
});
