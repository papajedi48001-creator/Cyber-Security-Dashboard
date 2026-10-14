// Email (SMTP with STARTTLS) and LINE OA (Messaging API push) adapters. Errors
// carry only a status or code, never the server's full reply or credentials.

import nodemailer from "nodemailer";
import type { NotificationChannel } from "./delivery";

const TIMEOUT_MS = 10_000;
export const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelError";
  }
}

export function createLineChannel({
  accessToken,
  to,
  fetchImpl = fetch,
}: {
  accessToken: string;
  to: string;
  fetchImpl?: typeof fetch;
}): NotificationChannel {
  return {
    name: "LINE",
    async send(text) {
      let response: Response;
      try {
        response = await fetchImpl(LINE_PUSH_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new ChannelError(`LINE ส่งไม่สำเร็จ: ${error instanceof Error ? error.name : "network error"}`);
      }
      if (!response.ok) throw new ChannelError(`LINE HTTP ${response.status}`);
    },
  };
}

export interface EmailSettings {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  to: string[];
}

interface MailTransport {
  sendMail(message: { from: string; to: string[]; subject: string; text: string }): Promise<unknown>;
}

export function createEmailChannel(settings: EmailSettings, transport?: MailTransport): NotificationChannel {
  const mailer: MailTransport =
    transport ??
    nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      requireTLS: settings.port !== 465,
      auth: settings.user ? { user: settings.user, pass: settings.password ?? "" } : undefined,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
  return {
    name: "EMAIL",
    async send(text) {
      try {
        await mailer.sendMail({ from: settings.from, to: settings.to, subject: text.split("\n")[0]!, text });
      } catch (error) {
        const e = error as { code?: unknown; responseCode?: unknown };
        const detail = [typeof e.code === "string" ? e.code : null, typeof e.responseCode === "number" ? e.responseCode : null]
          .filter((v) => v !== null)
          .join(" ");
        throw new ChannelError(`SMTP ส่งไม่สำเร็จ${detail ? `: ${detail}` : ""}`);
      }
    },
  };
}
