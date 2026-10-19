import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// End-to-end against the live JdbcOdata demo (https://odata.status20.net) through the viewer.
// Runs only with credentials, e.g.:
//   E2E_EXTERNAL=1 E2E_BASE_URL=https://odata-viewer.status20.net \
//   JDBCODATA_USER=excel_demo JDBCODATA_PASSWORD=… JDBCODATA_NORD_PASSWORD=… npx playwright test live-jdbcodata
// Every check compares what the viewer shows with a direct request to the service.

const SERVICE = process.env.JDBCODATA_URL ?? "https://odata.status20.net/odata/";
const USER = process.env.JDBCODATA_USER ?? "excel_demo";
const PASSWORD = process.env.JDBCODATA_PASSWORD ?? "";
const NORD_PASSWORD = process.env.JDBCODATA_NORD_PASSWORD ?? "";

test.skip(!PASSWORD, "JDBCODATA_PASSWORD not set");
test.describe.configure({ mode: "serial" });

function auth(user = USER, password = PASSWORD): Record<string, string> {
  return { Authorization: "Basic " + Buffer.from(`${user}:${password}`).toString("base64") };
}

/** A direct request to JdbcOdata (not through the viewer). */
async function direct(request: APIRequestContext, path: string, user = USER, password = PASSWORD) {
  const r = await request.get(SERVICE + path, { headers: { ...auth(user, password), Accept: "application/json" } });
  expect(r.status(), path).toBe(200);
  return r;
}

async function directCount(request: APIRequestContext, set: string, filter?: string, user = USER, password = PASSWORD) {
  const q = filter ? `?$filter=${encodeURIComponent(filter)}` : "";
  return Number(await (await direct(request, `${set}/$count${q}`, user, password)).text());
}

async function loadService(page: Page, url = SERVICE, user: string | null = USER, password = PASSWORD) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "OData service URL" }).fill(url);
  if (user) {
    await page.getByLabel("The service needs a login (HTTP Basic)").check();
    await page.getByRole("textbox", { name: "User name" }).fill(user);
    await page.getByLabel("Password").fill(password);
  }
  await page.getByRole("button", { name: "Load" }).click();
}

/** The data explorer's query form. */
function form(page: Page) {
  return page.locator("form").filter({ has: page.getByRole("button", { name: /Run$/ }) });
}

async function openData(page: Page, set: string) {
  await page.getByRole("tab", { name: "Data" }).click();
  await form(page).locator("select").first().selectOption(set);
}

async function moreOptions(page: Page) {
  const summary = form(page).getByText(/^More options/);
  const details = summary.locator("xpath=..");
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await summary.click();
}

async function run(page: Page) {
  await page.getByRole("button", { name: /Run$/ }).click();
  await expect(page.getByText(/HTTP 200/)).toBeVisible({ timeout: 30_000 });
}

/** The rows of the last result as JSON (the explorer's JSON view). */
async function resultRows(page: Page): Promise<Record<string, unknown>[]> {
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const text = await page.locator("pre").first().textContent();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  return JSON.parse(text ?? "[]");
}

async function shownCount(page: Page): Promise<number> {
  const label = await page.getByText(/^(Rows \d+–\d+|No rows)/).first().textContent();
  const m = /of ([\d.,  ]+)$/.exec(label ?? "");
  return m ? Number(m[1].replace(/[^\d]/g, "")) : NaN;
}

test("a resource URL loads the service root, with the whole model", async ({ page }) => {
  await loadService(page, SERVICE + "Organisation");
  await expect(page.getByText(/points into the service; loaded the metadata of the service root/)).toBeVisible();
  for (const set of ["Bestellungen", "Kunden", "Organisation", "Produkte", "Umsatz", "UmsatzProMonat"]) {
    await expect(page.getByRole("treeitem", { name: new RegExp(`^${set}\\b`) }).first()).toBeVisible();
  }
  // collection and complex properties of the demo arrive as types
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search the model" }).fill("Bestellungen_Positionen");
  await page.getByRole("option").first().click();
  await expect(page.getByRole("heading", { name: "Bestellungen_Positionen" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Betrag/ }).first()).toBeVisible();
});

test("filter, order and count match the service", async ({ page, request }) => {
  await loadService(page);
  await openData(page, "Kunden");
  await form(page).getByLabel("$filter", { exact: true }).fill("Region eq 'Nord'");
  await form(page).getByLabel("$orderby", { exact: true }).fill("Name desc");
  await form(page).getByLabel("$top", { exact: true }).fill("5");
  await form(page).getByRole("checkbox", { name: "$count" }).check();
  await run(page);
  expect(await shownCount(page)).toBe(await directCount(request, "Kunden", "Region eq 'Nord'"));
  const rows = await resultRows(page);
  expect(rows).toHaveLength(5);
  expect(rows.every((r) => r.Region === "Nord")).toBe(true);
  const names = rows.map((r) => String(r.Name));
  expect(names).toEqual([...names].sort().reverse());
  const expected = await (await direct(request, "Kunden?$filter=Region%20eq%20'Nord'&$orderby=Name%20desc&$top=5&$select=KundeId")).json();
  expect(rows.map((r) => Number(r.KundeId))).toEqual(expected.value.map((r: { KundeId: number }) => r.KundeId));

  // paging: the second page continues where the first ended
  await page.getByRole("button", { name: "Next ›" }).click();
  await expect(page.getByText(/^Rows 6–10/)).toBeVisible();
});

test("row-level security: excel_nord sees only Nord", async ({ page, request }) => {
  test.skip(!NORD_PASSWORD, "JDBCODATA_NORD_PASSWORD not set");
  await loadService(page, SERVICE, "excel_nord", NORD_PASSWORD);
  await openData(page, "Kunden");
  await form(page).getByRole("checkbox", { name: "$count" }).check();
  await run(page);
  const nord = await directCount(request, "Kunden", "Region eq 'Nord'");
  expect(await shownCount(page)).toBe(nord);
  expect(await directCount(request, "Kunden", undefined, "excel_nord", NORD_PASSWORD)).toBe(nord);
});

test("search, expand and navigation filters", async ({ page, request }) => {
  await loadService(page);
  await openData(page, "Kunden");
  await moreOptions(page);
  await form(page).getByLabel("$search", { exact: true }).fill("Wiener");
  await form(page).getByRole("checkbox", { name: "$count" }).check();
  await run(page);
  const searched = await (await direct(request, "Kunden?$search=Wiener&$count=true&$top=0")).json();
  expect(await shownCount(page)).toBe(searched["@odata.count"]);

  await openData(page, "Umsatz");
  await form(page).getByLabel("$filter", { exact: true }).fill("Kunde/Region eq 'Nord' and Betrag gt 5000");
  await form(page).getByLabel("$top", { exact: true }).fill("3");
  await form(page).getByRole("checkbox", { name: "$count" }).check();
  await moreOptions(page);
  await form(page).getByLabel("$expand", { exact: true }).fill("Kunde($select=Name,Region)");
  await run(page);
  expect(await shownCount(page)).toBe(await directCount(request, "Umsatz", "Kunde/Region eq 'Nord' and Betrag gt 5000"));
  const rows = await resultRows(page);
  expect(rows.length).toBe(3);
  for (const r of rows) {
    const kunde = r.Kunde as Record<string, unknown>;
    expect(kunde.Region).toBe("Nord");
    expect(Number(r.Betrag)).toBeGreaterThan(5000);
  }
});

test("collections: lambdas, complex values and $select with options", async ({ page, request }) => {
  await loadService(page);
  await openData(page, "Bestellungen");
  const filter = "Kundendaten/Land eq 'AT' and Kategorien/any(k:k eq 'Infrastruktur') and Positionen/$count ge 3";
  await form(page).getByLabel("$filter", { exact: true }).fill(filter);
  await form(page).getByLabel("$orderby", { exact: true }).fill("BestellungId");
  await form(page).getByLabel("$top", { exact: true }).fill("3");
  await form(page).getByRole("checkbox", { name: "$count" }).check();
  await moreOptions(page);
  await page
    .getByLabel("Custom query parameters")
    .fill("$select=BestellungId,Kundendaten,Kategorien,Positionen($filter=Betrag gt 100;$orderby=Betrag desc;$top=2;$select=Produkt,Betrag;$count=true)");
  await run(page);
  expect(await shownCount(page)).toBe(await directCount(request, "Bestellungen", filter));
  const rows = await resultRows(page);
  expect(rows.length).toBe(3);
  const ids = rows.map((r) => Number(r.BestellungId));
  const expected = await (
    await direct(
      request,
      `Bestellungen?$filter=${encodeURIComponent(filter)}&$orderby=BestellungId&$top=3&$select=BestellungId,Positionen`,
    )
  ).json();
  expect(ids).toEqual(expected.value.map((r: { BestellungId: number }) => r.BestellungId));
  for (const [i, r] of rows.entries()) {
    expect((r.Kundendaten as Record<string, unknown>).Land).toBe("AT");
    expect(r.Kategorien as string[]).toContain("Infrastruktur");
    const positions = r.Positionen as Record<string, unknown>[];
    const all = (expected.value[i].Positionen as { Betrag: number | string }[]).map((p) => Number(p.Betrag)).filter((b) => b > 100);
    expect(positions.length).toBe(Math.min(2, all.length));
    expect(Number(r["Positionen@odata.count"])).toBe(all.length);
    expect(Object.keys(positions[0]).sort()).toEqual(["Betrag", "Produkt"]);
    expect(positions.map((p) => Number(p.Betrag))).toEqual([...all].sort((a, b) => b - a).slice(0, 2));
  }
});

test("aggregation with $apply matches the service", async ({ page, request }) => {
  await loadService(page);
  await openData(page, "Umsatz");
  await moreOptions(page);
  await form(page).getByLabel("Custom query parameters", { exact: true }).fill("$apply=groupby((Region),aggregate(Betrag with sum as Summe))&p_jahr=2025");
  await form(page).getByLabel("$orderby", { exact: true }).fill("Region");
  await run(page);
  const rows = await resultRows(page);
  const expected = await (
    await direct(request, "Umsatz?$apply=groupby((Region),aggregate(Betrag%20with%20sum%20as%20Summe))&$orderby=Region&p_jahr=2025")
  ).json();
  expect(rows.map((r) => [r.Region, Number(r.Summe)])).toEqual(
    expected.value.map((r: { Region: string; Summe: number | string }) => [r.Region, Number(r.Summe)]),
  );
  expect(rows.map((r) => r.Region)).toEqual(["Nord", "Ost", "Süd", "West"]);
});

test("wrong password is explained, anonymous access uses the demo user", async ({ page, request }) => {
  await loadService(page, SERVICE, USER, "falsch");
  // $metadata is served from the snapshot; the wrong password shows up on the first data request
  const metadataError = page.getByRole("alert");
  if (await metadataError.isVisible().catch(() => false)) {
    await expect(metadataError).toContainText(/401|user name or password/);
  } else {
    await openData(page, "Kunden");
    await page.getByRole("button", { name: /Run$/ }).click();
    await expect(page.getByRole("alert")).toContainText(/401|user name or password|credentials/i, { timeout: 30_000 });
  }

  await loadService(page, SERVICE, null);
  await openData(page, "Produkte");
  await form(page).getByRole("checkbox", { name: "$count" }).check();
  await run(page);
  expect(await shownCount(page)).toBe(await directCount(request, "Produkte"));
});
