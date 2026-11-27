"use server";

import { revalidatePath } from "next/cache";
import { createCloudflareClient } from "@/lib/cloudflare/client";
import { safeError } from "@/lib/notifications/delivery";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";
import { ConnectorSettingsError, type ConnectorName } from "@/lib/settings/connectors";
import { createIndexerClient, httpsTransport } from "@/lib/wazuh/client";

export interface ConnectorFormState {
  ok?: boolean;
  message?: string;
}

const NAMES: ConnectorName[] = ["wazuh-indexer", "cloudflare"];

function connectorName(form: FormData): ConnectorName | null {
  const name = form.get("name")?.toString() as ConnectorName;
  return NAMES.includes(name) ? name : null;
}

export async function saveConnectorAction(_state: ConnectorFormState, form: FormData): Promise<ConnectorFormState> {
  const session = await requireActionSession("config.manage", form);
  const name = connectorName(form);
  if (!name) return { ok: false, message: "ไม่รู้จัก connector นี้" };
  try {
    await getServices().connectors.update(
      session.user,
      name,
      {
        target: form.get("target")?.toString() ?? "",
        username: form.get("username")?.toString(),
        secret: form.get("secret")?.toString(),
      },
      newCorrelationId(),
    );
  } catch (error) {
    if (error instanceof ConnectorSettingsError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/settings/connectors");
  return { ok: true, message: "บันทึกแล้ว รหัสจะไม่แสดงอีก" };
}

/** Read-only probe with the saved values: one small search or a one-hour summary. Audited. */
export async function testConnectorAction(_state: ConnectorFormState, form: FormData): Promise<ConnectorFormState> {
  const session = await requireActionSession("config.manage", form);
  const name = connectorName(form);
  if (!name) return { ok: false, message: "ไม่รู้จัก connector นี้" };
  const { connectors, config, audit } = getServices();
  let result: ConnectorFormState;
  try {
    const current = await connectors.effective(name);
    if (!current?.secret) throw new Error("ยังไม่ได้ตั้งค่า");
    const until = new Date();
    if (name === "wazuh-indexer") {
      if (!current.username) throw new Error("ยังไม่ได้ระบุบัญชี");
      await createIndexerClient({
        baseUrl: current.target.replace(/\/$/, ""),
        username: current.username,
        password: current.secret,
        transport: httpsTransport(config.wazuh.caCertPath),
      }).searchAlerts({ since: new Date(until.getTime() - 5 * 60_000), size: 1 });
    } else {
      await createCloudflareClient({ apiToken: current.secret, zoneId: current.target }).fetchSummary({
        since: new Date(until.getTime() - 3_600_000),
        until,
      });
    }
    result = { ok: true, message: "เชื่อมต่อสำเร็จ" };
  } catch (error) {
    result = { ok: false, message: `เชื่อมต่อไม่สำเร็จ: ${safeError(error)}` };
  }
  await audit.append({
    actor: { id: session.user.id, label: session.user.username },
    action: "connector.tested",
    target: { type: "Connector", id: name },
    metadata: { result: result.ok ? "ok" : "failed" },
    correlationId: newCorrelationId(),
  });
  return result;
}
