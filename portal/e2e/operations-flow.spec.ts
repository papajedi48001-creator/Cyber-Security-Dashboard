// Plan 3 integration UAT: one pass through every module with synthetic records
// only. The worker's cycles are run in-process against the e2e database so the
// browser sees what the real worker would have produced.
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { createAuditLog } from "../src/lib/audit";
import { PrismaAuditStore } from "../src/lib/db/audit-store";
import { PrismaDeliveryStore } from "../src/lib/db/delivery-store";
import { PrismaIncidentStore } from "../src/lib/db/incident-store";
import { PrismaPortStore } from "../src/lib/db/port-store";
import { createIncidentService } from "../src/lib/incidents/service";
import { createNotifier } from "../src/lib/notifications/delivery";
import { createPortMonitorService } from "../src/lib/port-monitor/service";
import { E2E_ENV, E2E_USERS, storageFile, type E2ERole } from "./env";

test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const alertTitle = `E2E priority alert ${run}`;
// A fresh documentation address per run, so an incident from an earlier run does not absorb this one.
const exposedAddress = `203.0.113.${100 + Math.floor(Math.random() * 150)}`;
let prisma: PrismaClient;
let incidentUrl = "";

/** The worker's services, with a LINE channel that always fails. */
function workerServices() {
  const audit = createAuditLog(new PrismaAuditStore(prisma));
  const notifier = createNotifier({
    store: new PrismaDeliveryStore(prisma),
    channels: [{ name: "LINE", send: async () => { throw new Error("LINE push failed (HTTP 500)"); } }],
    audit,
    portalBaseUrl: E2E_ENV.PORTAL_BASE_URL!,
  });
  const ports = createPortMonitorService({ store: new PrismaPortStore(prisma), audit });
  const incidents = createIncidentService({
    store: new PrismaIncidentStore(prisma),
    audit,
    notify: notifier.enqueue,
    suppressAlert: ports.isEgressExcepted,
  });
  return { notifier, ports, incidents };
}

async function pageAs(browser: import("@playwright/test").Browser, role: E2ERole) {
  return (await browser.newContext({ storageState: storageFile(role) })).newPage();
}

async function act(page: Page, button: string, status: string) {
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByRole("row", { name: `สถานะ ${status}` })).toBeVisible();
}

test.beforeAll(() => {
  prisma = new PrismaClient({ datasources: { db: { url: E2E_ENV.DATABASE_URL } } });
});
test.afterAll(() => prisma.$disconnect());

test("a priority Wazuh alert becomes a P1 incident and a failed notification is shown", async ({ browser }) => {
  await prisma.alertReference.create({
    data: {
      wazuhAlertId: `e2e-${run}`,
      ruleId: 100120,
      ruleLevel: 13,
      category: "admin_or_login_failure",
      description: alertTitle,
      sourceName: `e2e-sophos-${run}`,
      detectedAt: new Date(Date.now() - 5 * 60_000),
      investigationUrl: "https://wazuh.e2e.example/app/threat-hunting",
    },
  });
  const { incidents, notifier } = workerServices();
  const raised = await incidents.raisePending(`e2e-${run}`);
  const incident = raised.find((i) => i.title === alertTitle);
  expect(incident?.severity).toBe("P1");
  expect(await notifier.dispatchDue(`e2e-${run}`)).toMatchObject({ failed: expect.any(Number) });

  const page = await pageAs(browser, "opA");
  await page.goto("/incidents");
  const failure = page.getByRole("alert").filter({ hasText: "แจ้งเตือนส่งไม่สำเร็จ" });
  await expect(failure).toContainText(incident!.number);
  await expect(failure).toContainText("กำลังลองใหม่ (ครั้งที่ 1) — LINE push failed (HTTP 500)");
  await page.getByRole("link", { name: incident!.number, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 2, name: alertTitle })).toBeVisible();
  incidentUrl = page.url();

  await page.getByLabel("มอบหมายให้").selectOption({ label: E2E_USERS.opA.displayName });
  await act(page, "มอบหมาย", "มอบหมายแล้ว");
  await act(page, "รับทราบ", "รับทราบแล้ว");
  await act(page, "เริ่มตรวจสอบ", "กำลังตรวจสอบ");
  await act(page, "ควบคุมได้แล้ว", "ควบคุมได้แล้ว");
  await page.getByLabel("สาเหตุ").fill("Repeated admin login failures from one address");
  await page.getByLabel("การแก้ไข").fill("Address blocked and admin password rotated");
  await page.getByLabel("สรุปหลักฐาน").fill("No further failures after the block");
  await page.getByLabel("อ้างอิงหลักฐาน (ชื่อไฟล์/ที่เก็บ)").fill("evidence/e2e-uat-login.pdf");
  await act(page, "ส่งให้ตรวจ", "รอตรวจการปิด");
});

test("a second operator reviews the closure", async ({ browser }) => {
  const page = await pageAs(browser, "opB");
  await page.goto(incidentUrl);
  await act(page, "อนุมัติปิด", "ปิดแล้ว");
});

test("a failed backup shows as failing on the overview", async ({ browser }) => {
  const job = `e2e-uat-backup-${run}`;
  const admin = await pageAs(browser, "admin");
  await admin.goto("/backups");
  await admin.getByLabel("ชื่องาน (A-Z a-z 0-9 . _ -)").fill(job);
  await admin.getByRole("button", { name: "เพิ่มงาน" }).click();
  await expect(admin.getByRole("status")).toHaveText("บันทึกแล้ว");

  const operator = await pageAs(browser, "opA");
  await operator.goto("/backups");
  const form = operator.locator("form").filter({ hasText: "บันทึกผล backup" });
  await form.getByLabel("งาน").selectOption(job);
  await form.getByLabel("ผล").selectOption("FAILED");
  await form.getByLabel("เสร็จเมื่อ (เวลาไทย)").fill(new Date(Date.now() + 7 * 3_600_000 - 60_000).toISOString().slice(0, 16));
  await form.getByRole("button", { name: "บันทึกผล backup" }).click();
  await expect(operator.getByRole("row").filter({ hasText: job })).toContainText("ล้มเหลว");
  await operator.goto("/overview");
  await expect(operator.getByText(`${job}: ล้มเหลว 1 ครั้งติดกัน`)).toBeVisible();
});

test("an expired port exception no longer hides exposure and opens an incident", async ({ browser }) => {
  await prisma.portException.create({
    data: {
      family: "EXTERNAL_EXPOSURE",
      address: exposedAddress,
      port: 22,
      protocol: "TCP",
      reason: "E2E vendor access that has ended",
      owner: "IT",
      approvedById: "e2e",
      approvedAt: new Date(Date.now() - 40 * 86_400_000),
      expiresAt: new Date(Date.now() - 86_400_000),
    },
  });
  const finishedAt = new Date(Date.now() - 1000).toISOString();
  const operator = await pageAs(browser, "opA");
  await operator.goto("/port-monitor");
  await operator.getByLabel("หรือวาง JSON").fill(
    JSON.stringify({
      format: "external-exposure-scan/v1",
      scanner: "nmap 7.95",
      startedAt: finishedAt,
      finishedAt,
      targets: [exposedAddress],
      findings: [{ address: exposedAddress, port: 22, protocol: "TCP", service: "ssh" }],
    }),
  );
  await operator.getByRole("button", { name: "นำเข้าผลสแกน" }).click();
  await expect(operator.getByRole("status")).toHaveText("บันทึกแล้ว");
  const row = operator.getByRole("row").filter({ hasText: `${exposedAddress}` }).filter({ hasText: "22/TCP" }).first();
  await expect(row).toContainText("ข้อยกเว้นหมดอายุ");
  await expect(row).toContainText("P2");

  const { ports, incidents } = workerServices();
  const raised = await incidents.raiseFindings("system:port-monitor", await ports.findingsForIncidents(), `e2e-${run}`);
  const exposure = raised.find((i) => i.sourceName === `${exposedAddress}:22/TCP`);
  expect(exposure).toMatchObject({ severity: "P2", title: "พอร์ต 22/TCP เปิดสู่ Internet (ข้อยกเว้นหมดอายุ)" });
  await operator.goto("/incidents");
  await expect(operator.getByRole("row").filter({ hasText: exposure!.number })).toContainText("ข้อยกเว้นหมดอายุ");
});

test("the WAF view is sampled and the Duo check is manual", async ({ browser }) => {
  const page = await pageAs(browser, "opA");
  await page.goto("/web-application-firewall");
  await expect(page.getByRole("note")).toContainText("สุ่มตัวอย่าง");
  await expect(page.getByText("สถานะข้อมูล:")).toBeVisible();
  await page.goto("/duo");
  await expect(page.getByRole("note")).toContainText("ไม่ใช่การเฝ้าระวังแบบ real-time");
  await expect(page.getByRole("button", { name: "บันทึกผลการตรวจ" })).toBeVisible();
});
