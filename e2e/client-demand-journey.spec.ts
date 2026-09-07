import { expect, test, type Page } from "@playwright/test";

/**
 * Plan-04 Task 14 — the full client (guest) demand journey, end to end.
 *
 * Spec 07 §7 / the BRIEF's mandated E2E. It drives a real Chromium against
 * `pnpm start` (the Playwright config's `webServer`) with the seeded database
 * (`pnpm seed` — see `e2e/README.md`). No network stubs: every assertion is
 * against the shipped UI.
 *
 * Seeded fixtures this test relies on (`prisma/seed.ts`):
 *   - guest  `guest@northwind.example` / `Keel-guest-2026`
 *            displayName "Nadia (Northwind Traders)", client "Northwind Traders"
 *   - admin  `admin@keel.local` / `Keel-admin-2026` (INTERNAL, all hats)
 *   - a demo demand DEM-9001 (SUBMITTED) + a seeded guest notification
 *     "Your request DEM-9001 is being reviewed by the Keel team."
 *
 * Role switches clear the cookie jar rather than click "Sign out" — the logout
 * control has its own unit test; this spec is about the demand journey, and a
 * cookie reset keeps the role transitions deterministic.
 */

const GUEST = { email: "guest@northwind.example", password: "Keel-guest-2026" };
const ADMIN = { email: "admin@keel.local", password: "Keel-admin-2026" };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function signIn(
  page: Page,
  creds: { email: string; password: string },
  next: string,
): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${next}`);
}

test("client demand journey — submit, track, cross-check, notifications", async ({
  page,
  context,
}) => {
  const title = `Portal E2E request ${Date.now()}`;
  const problem =
    "Our team needs a shared way to export the weekly report as a spreadsheet.";
  const product = "Reporting portal";
  const titleRe = new RegExp(escapeRegExp(title));

  await test.step("guest signs in and lands on the portal", async () => {
    await signIn(page, GUEST, "/portal");
    await expect(
      page.getByRole("heading", { name: "Your requests" }),
    ).toBeVisible();
  });

  await test.step("the portal top bar shows the org name and the bell", async () => {
    await expect(
      page.getByText("Northwind Traders", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Notifications" }),
    ).toBeVisible();
  });

  await test.step("guest submits a request via /portal/submit", async () => {
    await page.goto("/portal/submit");
    await page
      .getByRole("tab", { name: "Request software or a feature" })
      .click();
    await page.getByLabel("What do you need", { exact: true }).fill(title);
    await page.getByLabel("What do you need and why").fill(problem);
    await page.getByLabel("Which product (optional)").fill(product);
    await page.getByRole("button", { name: "Send the request" }).click();
    await page.waitForURL("**/portal/demands");
  });

  await test.step("the new request shows in the list as 'In review'", async () => {
    const card = page.getByRole("link", { name: titleRe });
    await expect(card).toBeVisible();
    await expect(card).toContainText("In review");
  });

  await test.step("the request detail shows progress and a message box", async () => {
    await page.getByRole("link", { name: titleRe }).click();
    await page.waitForURL(/\/portal\/demands\/[^/]+$/);

    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("In review", { exact: true })).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "What you asked for" }),
    ).toBeVisible();
    await expect(page.getByText(problem)).toBeVisible();

    // The "Progress" section is the guest milestone timeline (plan-01
    // `PortalDemandDetail` + `<Timeline>`). A freshly submitted demand has one
    // guest-visible audit row — `demand.create` → "Demand raised".
    await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
    await expect(page.getByText("Demand raised")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
    await expect(page.getByLabel("Add a message")).toBeVisible();
  });

  await test.step("internal side sees the demand on /overview and /demands", async () => {
    await context.clearCookies();
    await signIn(page, ADMIN, "/overview");

    const triageTile = page
      .getByText("Demands in triage", { exact: true })
      .locator("..");
    await expect(triageTile).toBeVisible();
    await expect(triageTile).toContainText(/[1-9]/);

    await page.goto("/demands");
    await expect(page.getByText(title)).toBeVisible();
  });

  await test.step("the guest's /notifications lists their rows", async () => {
    await context.clearCookies();
    await signIn(page, GUEST, "/portal");

    await page.goto("/notifications");
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible();
    await expect(
      page.getByText(/being reviewed by the Keel team/),
    ).toBeVisible();
  });
});
