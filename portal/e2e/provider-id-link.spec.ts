// Provider ID Login (ADR 0009) browser checks with synthetic Provider IDs only.
// No real provider client is configured in e2e, so the login option stays hidden.
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { E2E_ENV, E2E_USERS, storageFile } from "./env";

const providerId = `E2E-PID-${Date.now().toString(36)}`;

test.afterAll(async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_ENV.DATABASE_URL } } });
  await prisma.externalIdentity.deleteMany({ where: { subject: providerId } });
  await prisma.$disconnect();
});

test("hides Provider ID Login until a provider client is configured", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "เข้าสู่ระบบด้วย Provider ID" })).toHaveCount(0);
  expect((await request.get("/login/provider-id/start", { maxRedirects: 0 })).status()).toBe(404);
  expect((await request.get("/login/provider-id/callback?code=x&state=y", { maxRedirects: 0 })).status()).toBe(404);
});

test("a pending MFA page without a challenge sends the user back to login", async ({ page }) => {
  await page.goto("/login/mfa");
  await expect(page).toHaveURL(/\/login$/);
});

test.describe("as Security Administrator", () => {
  test.use({ storageState: storageFile("admin") });

  test("links and unlinks a Provider ID for a user", async ({ page }) => {
    await page.goto("/admin/users");
    const row = page.getByRole("row").filter({ hasText: E2E_USERS.opB.username });
    await row.getByLabel("Provider ID").fill(providerId);
    await row.getByRole("button", { name: "ผูก" }).click();
    await expect(row.getByText(providerId)).toBeVisible();

    await row.getByRole("button", { name: "ยกเลิกการผูก" }).click();
    await expect(row.getByText(providerId)).toHaveCount(0);
    await expect(row.getByLabel("Provider ID")).toBeVisible();
  });
});
