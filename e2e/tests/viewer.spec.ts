import { expect, test, type Page } from "@playwright/test";

// The bundled snapshot keeps the test offline-safe; the live sample would also
// exercise the network path but depends on services.odata.org being up.
async function loadBundledSample(page: Page, sampleId = "northwind-v4") {
  await page.route(`**/api/samples/${sampleId}/load**`, (route) =>
    route.continue({ url: route.request().url().replace(/\?.*$/, "") + "?live=false" }),
  );
  await page.goto("/samples");
  await page.getByRole("button", { name: /^Northwind \(OData V4\) V4\.0/ }).click();
  await expect(page.getByRole("heading", { name: /northwind-v4\.xml/ })).toBeVisible();
}

test("landing page explains the tool and lists samples", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "See what an OData service looks like" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Northwind (OData V4)" })).toBeVisible();
  await expect(page).toHaveTitle(/Online OData Viewer/);
});

test("tree, details, diagram, source and data explorer", async ({ page }) => {
  await loadBundledSample(page);

  // Overview counts
  await expect(page.getByText("Entity sets", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("26").first()).toBeVisible();

  // Tree: entity types open by default for small models; pick Order.
  await expect(page.getByRole("treeitem", { name: /^Entity types 26/ })).toBeVisible();
  await page.getByRole("treeitem", { name: "Order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order", exact: true })).toBeVisible();
  await expect(page.getByText("Navigation properties")).toBeVisible();
  await expect(page.getByRole("row", { name: /Customer/ }).first()).toBeVisible();

  // Hash deep link carries the selection
  expect(page.url()).toContain("#/id/type%3ANorthwindModel.Order");

  // Diagram renders boxes and edges
  await page.getByRole("tab", { name: "Diagram" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  expect(await page.locator(".react-flow__node").count()).toBeGreaterThan(10);
  expect(await page.locator(".react-flow__edge").count()).toBeGreaterThan(5);

  // Source view loads the XML and highlights the selected line
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.locator(".cm-content")).toContainText("EntityType", { timeout: 15_000 });
  await expect(page.locator(".cm-src-highlight")).toHaveCount(1);

  // Data explorer: a bundled snapshot has no service root
  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.getByText(/no service to query/)).toBeVisible();
});

test("search palette finds a property and reveals it", async ({ page }) => {
  await loadBundledSample(page);
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search the model" }).fill("UnitPrice");
  await page.getByRole("option").first().click();
  await expect(page.getByRole("heading", { name: "UnitPrice" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /^UnitPrice/ }).first()).toBeVisible();
});

test("pasted metadata is parsed and errors are explained", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Paste" }).click();
  await page.getByRole("textbox", { name: "Metadata document" }).fill("<root/>");
  await page.getByRole("button", { name: "Parse" }).click();
  await expect(page.getByRole("alert")).toContainText("root element is <root>");

  const minimal = `<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices>
    <Schema Namespace="N" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="A"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.Int32" Nullable="false"/></EntityType>
      <EntityContainer Name="C"><EntitySet Name="As" EntityType="N.A"/></EntityContainer>
    </Schema></edmx:DataServices></edmx:Edmx>`;
  await page.getByRole("textbox", { name: "Metadata document" }).fill(minimal);
  await page.getByRole("button", { name: "Parse" }).click();
  await expect(page.getByRole("treeitem", { name: /^As\b/ })).toBeVisible();
});

test("data explorer queries through the backend proxy", async ({ page }) => {
  // Fake the live service: metadata plus one page of Products.
  const root = "https://fake.example/odata/";
  await page.route("**/api/metadata/url", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    expect(body.url).toBe(root);
    // Let the real backend parse the bundled file as if it came from the URL.
    const response = await route.fetch({ url: new URL(page.url()).origin + "/api/samples/northwind-v4/load?live=false", method: "POST", postData: "" });
    const model = await response.json();
    model.service_root = root;
    model.metadata_url = root + "$metadata";
    model.source = "url";
    await route.fulfill({ json: model });
  });
  await page.route("**/api/data/query", (route) =>
    route.fulfill({
      json: {
        request_url: root + "Products?$top=2&$count=true",
        status_code: 200,
        columns: ["ProductID", "ProductName"],
        rows: [
          { ProductID: 1, ProductName: "Chai" },
          { ProductID: 2, ProductName: "Chang" },
        ],
        count: 77,
        next_link: null,
        duration_ms: 12,
        notices: [],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("textbox", { name: "OData service URL" }).fill(root);
  await page.getByRole("button", { name: "Load" }).click();
  await page.getByRole("tab", { name: "Data" }).click();
  await page.getByRole("combobox", { name: "Entity set" }).selectOption("Products");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("cell", { name: "Chai" })).toBeVisible();
  await expect(page.getByText("Rows 1–2 of 77")).toBeVisible();
});
