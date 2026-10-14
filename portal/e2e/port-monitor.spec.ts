import { expect, test } from "@playwright/test";
import { storageFile } from "./env";

test("an imported scan shows unapproved exposure until an expiring exception covers it", async ({ browser }) => {
  const finishedAt = new Date(Date.now() - 1000).toISOString();
  const summary = JSON.stringify({
    format: "external-exposure-scan/v1",
    scanner: "nmap 7.95",
    startedAt: finishedAt,
    finishedAt,
    targets: ["203.0.113.30"],
    findings: [
      { address: "203.0.113.30", port: 3389, protocol: "TCP", service: "ms-wbt-server" },
      { address: "203.0.113.30", port: 8443, protocol: "TCP", service: "https-alt" },
    ],
  });

  const operator = await (await browser.newContext({ storageState: storageFile("opA") })).newPage();
  await operator.goto("/port-monitor");
  await operator.getByLabel("หรือวาง JSON").fill(summary);
  await operator.getByRole("button", { name: "นำเข้าผลสแกน" }).click();
  await expect(operator.getByRole("status")).toHaveText("บันทึกแล้ว");
  await expect(operator.getByText("ผลสแกนเป็นปัจจุบัน")).toBeVisible();
  const rdp = operator.getByRole("row").filter({ hasText: "3389/TCP" }).first();
  await expect(rdp).toContainText("ไม่ได้รับอนุมัติ");
  await expect(rdp).toContainText("P2");
  await expect(operator.getByRole("button", { name: "อนุมัติข้อยกเว้น" })).toHaveCount(0);

  const admin = await (await browser.newContext({ storageState: storageFile("admin") })).newPage();
  await admin.goto("/port-monitor");
  await admin.getByLabel("Public address (เฉพาะการเปิดพอร์ต)").fill("203.0.113.30");
  await admin.getByLabel("Port", { exact: true }).fill("8443");
  await admin.getByLabel("เหตุผล").fill("Vendor portal for e2e");
  await admin.getByLabel("ผู้รับผิดชอบ").fill("IT");
  const inThirtyDays = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await admin.getByLabel("หมดอายุวันที่").fill(inThirtyDays);
  await admin.getByRole("button", { name: "อนุมัติข้อยกเว้น" }).click();
  await expect(admin.getByRole("status")).toHaveText("บันทึกแล้ว");
  await expect(admin.getByRole("row").filter({ hasText: "8443/TCP" }).filter({ hasText: "https-alt" })).toContainText("อนุมัติแล้ว");
});

test("Executive Viewer cannot open the Port Monitor", async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: storageFile("exec") })).newPage();
  await page.goto("/port-monitor");
  await expect(page).toHaveURL(/\/forbidden$/);
});
