import { expect, test, type Page } from "@playwright/test";

async function loadBundledSample(page: Page) {
  await page.route("**/api/samples/northwind-v4/load**", (route) =>
    route.continue({ url: route.request().url().replace(/\?.*$/, "") + "?live=false" }),
  );
  await page.goto("/samples");
  await page.getByRole("button", { name: /^Northwind \(OData V4\) V4\.0/ }).click();
  await expect(page.getByText(/northwind-v4\.xml/).first()).toBeVisible();
}

test("no horizontal overflow on the landing page", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("panes switch via the bottom nav on phones or the tab strip on tablets", async ({ page }, testInfo) => {
  await loadBundledSample(page);
  if (testInfo.project.name === "phone") {
    const nav = page.getByRole("navigation", { name: "Panes" });
    await expect(nav).toBeVisible();
    await nav.getByRole("button", { name: "Tree" }).click();
    await expect(page.getByRole("treeitem", { name: /^Entity types/ })).toBeVisible();
    await nav.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
    await nav.getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("heading", { name: /northwind-v4\.xml/ })).toBeVisible();
  } else {
    await expect(page.getByRole("navigation", { name: "Panes" })).toBeHidden();
    await page.getByRole("button", { name: "Tree" }).click();
    await expect(page.getByRole("treeitem", { name: /^Entity types/ })).toBeVisible();
    // The drawer covers the tab strip; Escape closes it.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("complementary", { name: "Model tree" })).toBeHidden();
    await page.getByRole("tab", { name: "Diagram" }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
