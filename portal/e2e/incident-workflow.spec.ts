import { expect, test, type Page } from "@playwright/test";
import { E2E_USERS, storageFile } from "./env";

const asRole = (role: Parameters<typeof storageFile>[0]) => ({ storageState: storageFile(role) });

/** Clicks an action button and waits until the incident shows the expected status. */
async function act(page: Page, button: string, status: string) {
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByRole("row", { name: `สถานะ ${status}` })).toBeVisible();
}

test.describe("P1 incident with separate closure review", () => {
  let incidentUrl = "";
  // Base 36 keeps the run id from looking like a 13-digit national ID, which the Portal rejects.
  const title = `E2E suspicious admin login ${Date.now().toString(36)}`;

  test("operator opens, owns and mitigates the incident, then submits Closure Evidence", async ({ browser }) => {
    const context = await browser.newContext(asRole("opA"));
    const page = await context.newPage();
    await page.goto("/incidents");
    await page.getByLabel("หัวข้อ (ห้ามใส่ข้อมูลผู้ป่วย)").fill(title);
    await page.getByLabel("ระดับ").last().selectOption("P1");
    await page.getByLabel("เวลาที่ตรวจพบ (เวลาไทย)").fill("2026-10-14T09:00");
    await act(page, "เปิด incident", "ใหม่");
    await expect(page).toHaveURL(/\/incidents\/[^/]+$/);
    incidentUrl = page.url();
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();

    await page.getByLabel("มอบหมายให้").selectOption({ label: E2E_USERS.opA.displayName });
    await act(page, "มอบหมาย", "มอบหมายแล้ว");
    await act(page, "รับทราบ", "รับทราบแล้ว");
    await act(page, "เริ่มตรวจสอบ", "กำลังตรวจสอบ");
    await act(page, "ควบคุมได้แล้ว", "ควบคุมได้แล้ว");
    await expect(page.getByRole("button", { name: "ปิด incident" })).toHaveCount(0); // P1 cannot be closed directly

    await page.getByLabel("สาเหตุ").fill("Exposed admin service");
    await page.getByLabel("การแก้ไข").fill("Restricted to management VLAN");
    await page.getByLabel("สรุปหลักฐาน").fill("Re-test shows the service is no longer reachable");
    await page.getByLabel("อ้างอิงหลักฐาน (ชื่อไฟล์/ที่เก็บ)").fill("evidence/e2e-retest.pdf");
    await act(page, "ส่งให้ตรวจ", "รอตรวจการปิด");
    await expect(page.getByRole("button", { name: "อนุมัติปิด" })).toHaveCount(0); // owner cannot review
    await context.close();
  });

  test("a different operator reviews and closes it", async ({ browser }) => {
    const context = await browser.newContext(asRole("opB"));
    const page = await context.newPage();
    await page.goto(incidentUrl);
    await page.getByLabel("บันทึกการอนุมัติ (ถ้ามี)").fill("Evidence verified");
    await act(page, "อนุมัติปิด", "ปิดแล้ว");
    await expect(page.getByText(`${E2E_USERS.opB.displayName} เมื่อ`)).toBeVisible();
    const timeline = page.locator("table").last();
    for (const entry of ["เปิด incident", "มอบหมาย", "รับทราบ", "ส่ง Closure Evidence", "อนุมัติการปิด"])
      await expect(timeline.getByRole("cell", { name: entry, exact: true })).toBeVisible();
    await context.close();
  });
});

test.describe("Executive Viewer", () => {
  test.use(asRole("exec"));

  test("sees only the summary and is refused technical pages", async ({ page }) => {
    await page.goto("/executive");
    await expect(page.getByRole("heading", { name: "รายงานผู้บริหาร" })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Incident" })).toHaveCount(0);
    await expect(page.getByText("E2E suspicious admin login")).toHaveCount(0);
    for (const path of ["/incidents", "/overview", "/sources", "/assets", "/admin/users"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/forbidden$/);
    }
  });
});

test.describe("access gate", () => {
  test("refuses requests from outside the trusted networks", async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.50" } });
    const response = await (await context.newPage()).goto("/login");
    expect(response?.status()).toBe(403);
    await context.close();
  });

  test("sends a signed-out visitor to the login page", async ({ page }) => {
    await page.goto("/incidents");
    await expect(page).toHaveURL(/\/login$/);
  });
});
