"use server";

import type { ChannelName } from "@/lib/notifications/delivery";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";

export interface TestSendState {
  channel?: ChannelName;
  ok?: boolean;
  message?: string;
}

export async function sendTestAction(_state: TestSendState, form: FormData): Promise<TestSendState> {
  const session = await requireActionSession("config.manage", form);
  const channel = form.get("channel")?.toString();
  if (channel !== "EMAIL" && channel !== "LINE") return { ok: false, message: "ช่องทางไม่ถูกต้อง" };
  const result = await getServices().notifier.sendTest(session.user, channel, newCorrelationId());
  return result.ok
    ? { channel, ok: true, message: "ส่งข้อความทดสอบแล้ว ตรวจที่ปลายทางว่าได้รับ" }
    : { channel, ok: false, message: `ส่งไม่สำเร็จ: ${result.error}` };
}
