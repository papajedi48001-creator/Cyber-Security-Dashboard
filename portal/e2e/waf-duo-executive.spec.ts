import { expect, test } from "@playwright/test";
import { E2E_USERS, storageFile } from "./env";

test("WAF view is labelled sampled and shows unknown instead of zero without data", async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: storageFile("opA") })).newPage();
  await page.goto("/web-application-firewall");
  await expect(page.getByRole("note")).toContainText("สุ่มตัวอย่าง");
  await expect(page.getByText("ยังไม่ทราบจำนวนเหตุการณ์ (ไม่ใช่ศูนย์)")).toBeVisible();
});

test("Duo manual check records who checked and when", async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: storageFile("opB") })).newPage();
  await page.goto("/duo");
  await expect(page.getByRole("note")).toContainText("ไม่ใช่การเฝ้าระวังแบบ real-time");
  const now = new Date(Date.now() + 7 * 3_600_000 - 60_000).toISOString().slice(0, 16); // Bangkok local, a minute ago
  await page.getByLabel("ตรวจเมื่อ (เวลาไทย)").fill(now);
  await page.getByLabel("ตรวจ Authentication Log 24 ชั่วโมงล่าสุดแล้ว").check();
  await page.getByLabel("ตรวจ Administrator Actions แล้ว").check();
  await page.getByLabel("จำนวนการยืนยันตัวตนที่ถูกปฏิเสธ").fill("2");
  await page.getByLabel("จำนวน Fraud report").fill("0");
  await page.getByLabel("จำนวนผู้ใช้สถานะ bypass").fill("0");
  await page.getByRole("button", { name: "บันทึกผลการตรวจ" }).click();
  await expect(page.getByRole("status")).toHaveText("บันทึกแล้ว");
  await expect(page.getByText(`ตรวจล่าสุดโดย ${E2E_USERS.opB.username}`)).toBeVisible();
  await expect(page.getByText("ตรวจแล้วตามรอบ")).toBeVisible();
});

test("the executive summary carries no addresses, usernames or incident titles", async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: storageFile("exec") })).newPage();
  await page.goto("/executive");
  await expect(page.getByRole("heading", { name: "เรื่องที่ควรติดตาม" })).toBeVisible();
  await expect(page.getByText("ข้อมูลสุ่มตัวอย่าง")).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  const leaks: string[] = [...Object.values(E2E_USERS).map((u) => u.username), "E2E suspicious admin login", "e2e-backup-"];
  for (const leak of leaks) expect(text).not.toContain(leak);
});
