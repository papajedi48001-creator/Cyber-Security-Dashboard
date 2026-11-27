import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_ENV, storageFile } from "./env";

// Synthetic GDCC status: file names and sizes only, as the store job writes them.
const run = Date.now().toString(36);
const GIB = 1024 ** 3;
const utc = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const stampFor = (daysAgo: number) => {
  const d = new Date(Date.now() + 7 * 3_600_000 - daysAgo * 86_400_000);
  return `${d.toISOString().slice(0, 10).replaceAll("-", "")}000103`;
};
const names = [0, 1, 3].map((daysAgo) => `MySQL_backup_e2e${run}_${stampFor(daysAgo)}.ZIP`);
const oldest = names[2]!;

function writeStatus(generatedAt: Date) {
  const path = E2E_ENV.GDCC_FILES_STATUS_PATH!;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      schema: 1,
      generated_at: utc(generatedAt),
      volume: { total_bytes: 440 * GIB, used_bytes: 350 * GIB, free_bytes: 90 * GIB },
      max_use_percent: 85,
      keep_min: 2,
      files: names.map((name, i) => ({ name, size_bytes: 35 * GIB, modified_at: utc(new Date(Date.now() - [0, 1, 3][i]! * 86_400_000)), checksum: "verified" })),
      inbox_pending: 0,
      pruned: [],
      corrupt: [],
      requests: [],
    }),
  );
}

test.describe.configure({ mode: "serial" });

test("destroying a GDCC backup file needs a reason, a second person's approval and a hold", async ({ browser }) => {
  writeStatus(new Date());
  const operator = await (await browser.newContext({ storageState: storageFile("opA") })).newPage();
  await operator.goto("/backups/files");
  await expect(operator.getByText("ข้อมูลเป็นปัจจุบัน")).toBeVisible();
  await expect(operator.getByText("ขาด 1 วัน ในช่วงที่ยังเก็บไฟล์อยู่")).toBeVisible();
  const row = (page: typeof operator, name: string) => page.getByRole("row").filter({ hasText: name });
  await expect(row(operator, names[0]!)).toContainText("ไฟล์ล่าสุด เก็บไว้เสมอ");
  await expect(operator.getByRole("button", { name: /ลบทันที|กู้คืน|restore/i })).toHaveCount(0);

  await row(operator, oldest).getByText("ขอทำลายไฟล์นี้").click();
  await row(operator, oldest).getByLabel("เหตุผล").fill("พื้นที่ใกล้เต็ม ไฟล์นี้เก่ากว่าที่ต้องเก็บ");
  await row(operator, oldest).getByLabel(/เข้าใจว่าเมื่อได้รับอนุมัติ/).check();
  await row(operator, oldest).getByRole("button", { name: "ส่งคำขอทำลาย" }).click();
  await expect(operator.getByRole("status")).toContainText("ส่งคำขอแล้ว");
  await expect(row(operator, oldest).first()).toContainText("รออนุมัติ");

  const otherOperator = await (await browser.newContext({ storageState: storageFile("opB") })).newPage();
  await otherOperator.goto("/backups/files");
  const request = (page: typeof operator) => page.locator("tr", { has: page.locator("summary") }).filter({ hasText: oldest }).filter({ hasText: "e2e-op-a" });
  await expect(otherOperator.getByRole("row").filter({ hasText: "e2e-op-a" }).filter({ hasText: oldest }).getByText("พิจารณา")).toHaveCount(0);

  const admin = await (await browser.newContext({ storageState: storageFile("admin") })).newPage();
  await admin.goto("/backups/files");
  await request(admin).getByText("พิจารณา").click();
  await request(admin).getByLabel("ตรวจชื่อไฟล์และเหตุผลแล้ว").check();
  await request(admin).getByRole("button", { name: /อนุมัติ/ }).first().click();
  await expect(admin.getByRole("status")).toContainText("อนุมัติแล้ว");
  await expect(admin.getByRole("row").filter({ hasText: "e2e-op-a" }).filter({ hasText: oldest })).toContainText("อยู่ในช่วงพักรอ");

  await operator.goto("/backups/files");
  await request(operator).getByText("ยกเลิกคำขอ").first().click();
  await request(operator).getByLabel("ยกเลิก ไฟล์ยังเก็บไว้").check();
  await request(operator).getByRole("button", { name: "ยกเลิกคำขอ" }).click();
  await expect(operator.getByRole("status")).toContainText("ยกเลิกคำขอแล้ว");
  await expect(operator.getByRole("row").filter({ hasText: "e2e-op-a" }).filter({ hasText: oldest })).toContainText("ยกเลิก");
});

test("an old GDCC status shows as stale and accepts no new requests", async ({ browser }) => {
  writeStatus(new Date(Date.now() - 2 * 3_600_000));
  const page = await (await browser.newContext({ storageState: storageFile("opA") })).newPage();
  await page.goto("/backups/files");
  await expect(page.getByText("ข้อมูลไม่เป็นปัจจุบัน")).toBeVisible();
  await expect(page.getByText("ขอทำลายไฟล์นี้")).toHaveCount(0);
});

test("Executive Viewer cannot open GDCC backup files", async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: storageFile("exec") })).newPage();
  await page.goto("/backups/files");
  await expect(page).toHaveURL(/\/forbidden$/);
});
