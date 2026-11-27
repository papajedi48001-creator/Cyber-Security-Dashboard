import { expect, test } from "@playwright/test";
import { storageFile } from "./env";

const asRole = (role: "admin" | "opA" | "exec") => ({ storageState: storageFile(role) });

test.describe("navigation by role", () => {
  test("an administrator sees the modules and the System Settings group", async ({ browser }) => {
    const page = await (await browser.newContext(asRole("admin"))).newPage();
    await page.goto("/overview");
    await expect(page).toHaveTitle("Waritchaphum Security Dashboard");
    const rail = page.getByRole("navigation", { name: "เมนูหลัก" });
    await expect(rail.getByText("ตั้งค่าระบบ")).toBeVisible();
    await expect(rail.getByRole("link", { name: "เหตุการณ์ความปลอดภัย" })).toBeVisible();
    await expect(page.locator(".tile").first()).toBeVisible();
  });

  test("an operator sees modules but not System Settings", async ({ browser }) => {
    const page = await (await browser.newContext(asRole("opA"))).newPage();
    await page.goto("/overview");
    const rail = page.getByRole("navigation", { name: "เมนูหลัก" });
    await expect(rail.getByRole("link", { name: "สุขภาพแหล่ง Log" })).toBeVisible();
    await expect(rail.getByText("ตั้งค่าระบบ")).toHaveCount(0);
    await page.goto("/settings/modules");
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test("an executive viewer sees only the reporting modules", async ({ browser }) => {
    const page = await (await browser.newContext(asRole("exec"))).newPage();
    await page.goto("/executive");
    const rail = page.getByRole("navigation", { name: "เมนูหลัก" });
    await expect(rail.getByRole("link", { name: "รายงานผู้บริหาร" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "ทะเบียนทรัพย์สิน" })).toHaveCount(0);
  });
});

test("disabling an optional module hides it and its page until re-enabled", async ({ browser }) => {
  const page = await (await browser.newContext(asRole("admin"))).newPage();
  await page.goto("/settings/modules");
  const row = page.getByRole("row").filter({ hasText: "Cloudflare WAF" });
  await row.getByRole("button", { name: "ปิดโมดูล" }).click();
  await expect(row.getByRole("button", { name: "เปิดโมดูล" })).toBeVisible();
  const rail = page.getByRole("navigation", { name: "เมนูหลัก" });
  await expect(rail.getByRole("link", { name: "Cloudflare WAF" })).toHaveCount(0);
  const response = await page.goto("/web-application-firewall");
  expect(response?.status()).toBe(404);

  await page.goto("/settings/modules");
  await page.getByRole("row").filter({ hasText: "Cloudflare WAF" }).getByRole("button", { name: "เปิดโมดูล" }).click();
  await expect(rail.getByRole("link", { name: "Cloudflare WAF" })).toBeVisible();
});

test("core modules cannot be switched off", async ({ browser }) => {
  const page = await (await browser.newContext(asRole("admin"))).newPage();
  await page.goto("/settings/modules");
  const row = page.getByRole("row").filter({ hasText: "ทะเบียนทรัพย์สิน" });
  await expect(row.getByText("เปิดเสมอ")).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
});

test.describe("System Settings pages", () => {
  test("users moved under System Settings and the old address redirects", async ({ browser }) => {
    const page = await (await browser.newContext(asRole("admin"))).newPage();
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/settings\/users$/);
    await expect(page.getByRole("heading", { level: 1, name: "ผู้ใช้และสิทธิ์" })).toBeVisible();
  });

  test("the audit log lists records and offers no way to change them", async ({ browser }) => {
    const page = await (await browser.newContext(asRole("admin"))).newPage();
    await page.goto("/settings/audit?group=auth.");
    await expect(page.getByRole("heading", { level: 1, name: "บันทึกการใช้งาน" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "auth.login_succeeded" }).first()).toBeVisible();
    await expect(page.locator("main form[method='post'], main button:not([type='submit'])")).toHaveCount(0);
  });

  test("the notifications page shows the channels and a synthetic sample", async ({ browser }) => {
    const page = await (await browser.newContext(asRole("admin"))).newPage();
    await page.goto("/settings/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "การแจ้งเตือน" })).toBeVisible();
    await expect(page.getByText("INC-2026-0001")).toBeVisible();
  });

  test("only administrators reach System Settings", async ({ browser }) => {
    const page = await (await browser.newContext(asRole("opA"))).newPage();
    for (const path of ["/settings/users", "/settings/audit", "/settings/notifications"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/forbidden$/);
    }
  });
});
