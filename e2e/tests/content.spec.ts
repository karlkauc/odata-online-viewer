import { expect, test } from "@playwright/test";

const root = "https://services.odata.org/V4/Northwind/Northwind.svc/";

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("content pages are readable and link into the viewer", async ({ page }) => {
    await page.goto("/guides/odata-query-options");
    await expect(page.getByRole("heading", { level: 1, name: "OData query options cheat sheet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the TripPin data explorer" })).toHaveAttribute("href", /\?sample=trippin-v4#\/id\/set%3A/);
    await expect(page.getByText("Part of the FreeXmlToolkit family")).toBeVisible();
  });

  test("the home shell carries the FAQ", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Are my credentials stored?")).toBeVisible();
  });

  test("sample pages list entity sets", async ({ page }) => {
    await page.goto("/samples/northwind-v4");
    await expect(page.getByRole("link", { name: "Products", exact: true })).toBeVisible();
  });
});

test("a shared query link opens the explorer and runs the query", async ({ page }) => {
  // The bundled snapshot has no service root; pretend it is live so the explorer runs.
  await page.route("**/api/samples/northwind-v4/load**", async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(/\?.*$/, "") + "?live=false" });
    const model = await response.json();
    await route.fulfill({ json: { ...model, service_root: root } });
  });
  let options: Record<string, unknown> | null = null;
  await page.route("**/api/data/query", (route) => {
    options = JSON.parse(route.request().postData() ?? "{}").options;
    return route.fulfill({
      json: { request_url: root + "Products?$filter=UnitPrice gt 50&$top=5", status_code: 200, columns: ["ProductID", "ProductName"], rows: [{ ProductID: 38, ProductName: "Côte de Blaye" }], count: 2, next_link: null, duration_ms: 5, notices: [] },
    });
  });
  await page.goto("/?sample=northwind-v4#/id/set%3AODataWebV4.Northwind.Model.NorthwindEntities%2FProducts?view=data&filter=UnitPrice%20gt%2050&top=5");
  await expect(page.getByText("Côte de Blaye")).toBeVisible();
  expect(options).toMatchObject({ filter: "UnitPrice gt 50", top: 5 });
  await page.getByRole("button", { name: /Copy as/ }).click();
  await expect(page.getByRole("menuitem", { name: "Power Query M" })).toBeVisible();
});

test("the landing page and the sample list link to the content pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "OData query options cheat sheet" })).toHaveAttribute("href", "/guides/odata-query-options");
  await page.goto("/samples");
  await expect(page.getByRole("link", { name: "Entity sets and example queries →" }).first()).toHaveAttribute("href", /^\/samples\//);
  await page.goto("/");
  await page.getByRole("link", { name: "All guides and resources →" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Guides and resources" })).toBeVisible();
  await expect(page.getByRole("link", { name: /SAP Gateway/ })).toBeVisible();
});
