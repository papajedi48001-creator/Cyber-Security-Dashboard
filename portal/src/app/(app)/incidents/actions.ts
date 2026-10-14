"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Permission } from "@/lib/auth/authorize";
import type { ValidSession } from "@/lib/auth/service";
import type { IncidentStatus } from "@/lib/incidents/service";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";
import type { Severity } from "@/lib/wazuh/normalize-alert";

const field = (form: FormData, name: string) => form.get(name)?.toString() ?? "";

// Rule violations come back to the page as a message; anything else is a real error.
async function run(
  form: FormData,
  permission: Permission,
  back: string,
  work: (user: ValidSession["user"], correlationId: string) => Promise<string | void>,
) {
  const session = await requireActionSession(permission, form);
  let target: string = back;
  try {
    const next = await work(session.user, newCorrelationId());
    if (next) target = next;
  } catch (error) {
    if (error instanceof Error && (error.name === "IncidentRuleError" || error.name === "UnsafeAuditDataError"))
      redirect(`${back}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidatePath("/incidents");
  redirect(target);
}

export async function createIncidentAction(form: FormData) {
  await run(form, "incident.write", "/incidents", async (user, corr) => {
    const detected = new Date(`${field(form, "detectedAt")}:00+07:00`);
    if (Number.isNaN(detected.getTime())) throw Object.assign(new Error("เวลาที่ตรวจพบไม่ถูกต้อง"), { name: "IncidentRuleError" });
    const incident = await getServices().incidents.createIncident(
      user,
      { title: field(form, "title"), severity: field(form, "severity") as Severity, detectedAt: detected },
      corr,
    );
    return `/incidents/${incident.id}`;
  });
}

export async function promoteAlertAction(form: FormData) {
  await run(form, "incident.write", "/incidents", async (user, corr) => {
    const incident = await getServices().incidents.promoteAlert(user, field(form, "alertId"), field(form, "severity") as Severity, corr);
    return `/incidents/${incident.id}`;
  });
}

export async function incidentAction(form: FormData) {
  const id = field(form, "id");
  const op = field(form, "op");
  await run(form, op === "review" ? "incident.review" : "incident.write", `/incidents/${id}`, async (user, corr) => {
    const incidents = getServices().incidents;
    switch (op) {
      case "assign":
        await incidents.assignIncident(user, id, field(form, "ownerId"), corr);
        return;
      case "acknowledge":
        await incidents.acknowledgeIncident(user, id, corr);
        return;
      case "transition":
        await incidents.transitionIncident(user, id, field(form, "to") as IncidentStatus, corr);
        return;
      case "severity":
        await incidents.changeSeverity(user, id, field(form, "severity") as Severity, field(form, "reason"), corr);
        return;
      case "close":
        await incidents.closeIncident(user, id, { cause: field(form, "cause"), remediation: field(form, "remediation") }, corr);
        return;
      case "submit":
        await incidents.submitClosureEvidence(
          user,
          id,
          { cause: field(form, "cause"), remediation: field(form, "remediation"), summary: field(form, "summary"), reference: field(form, "reference") },
          corr,
        );
        return;
      case "review":
        await incidents.reviewClosure(user, id, { approve: field(form, "decision") === "approve", note: field(form, "note") }, corr);
        return;
      default:
        throw Object.assign(new Error("คำสั่งไม่ถูกต้อง"), { name: "IncidentRuleError" });
    }
  });
}
