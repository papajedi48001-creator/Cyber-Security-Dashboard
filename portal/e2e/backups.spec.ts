import { expect, test } from "@playwright/test";
import { storageFile } from "./env";

const job = `e2e-backup-${Date.now().toString(36)}`;

test("backup success stays unconfirmed until a separate restore test passes", async ({ browser }) => {
  const admin = await (await browser.newContext({ storageState: storageFile("admin") })).newPage();
  await admin.goto("/backups");
  await admin.getByLabel("ชื่องาน (A-Z a-z 0-9 . _ -)").fill(job);
  await admin.getByRole("button", { name: "เพิ่มงาน" }).click();
  await expect(admin.getByRole("status")).toHaveText("บันทึกแล้ว");
  const row = (page: typeof admin) => page.getByRole("row").filter({ hasText: job });
  await expect(row(admin)).toContainText("ไม่มีข้อมูล");

  const operator = await (await browser.newContext({ storageState: storageFile("opA") })).newPage();
  await operator.goto("/backups");
  await expect(operator.getByRole("button", { name: "เพิ่มงาน" })).toHaveCount(0);
  const evidenceForm = operator.locator("form").filter({ hasText: "บันทึกผล backup" });
  await evidenceForm.getByLabel("งาน").selectOption(job);
  await evidenceForm.getByLabel("เสร็จเมื่อ (เวลาไทย)").fill("2026-10-14T01:00");
  await evidenceForm.getByRole("button", { name: "บันทึกผล backup" }).click();
  await expect(row(operator)).toContainText("สำรองตามรอบ");
  await expect(row(operator)).toContainText("ยังไม่ยืนยันการกู้คืน");

  const restoreForm = operator.locator("form").filter({ hasText: "บันทึกผลทดสอบกู้คืน" });
  await restoreForm.getByLabel("งาน").selectOption(job);
  await restoreForm.getByLabel("ทดสอบเมื่อ (เวลาไทย)").fill("2026-10-14T02:00");
  await restoreForm.getByLabel("อ้างอิงหลักฐาน (ชื่อไฟล์/ที่เก็บ)").fill("restore-test-e2e.pdf");
  await restoreForm.getByRole("button", { name: "บันทึกผลทดสอบกู้คืน" }).click();
  await expect(row(operator)).toContainText("ทดสอบกู้คืนผ่าน");
  await expect(operator.getByRole("button", { name: /กู้คืนทันที|ลบ|restore/i })).toHaveCount(0);
});

test("Executive Viewer cannot open Backup Evidence", async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: storageFile("exec") })).newPage();
  await page.goto("/backups");
  await expect(page).toHaveURL(/\/forbidden$/);
});
