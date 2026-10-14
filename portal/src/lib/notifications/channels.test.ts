import { describe, expect, it } from "vitest";
import { createEmailChannel, createLineChannel, LINE_PUSH_URL } from "./channels";

describe("LINE OA channel", () => {
  it("pushes a single text message with the channel token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const channel = createLineChannel({
      accessToken: "line-token",
      to: "Cgroup",
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await channel.send("[P1] INC-2026-0001");
    expect(calls[0]!.url).toBe(LINE_PUSH_URL);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ to: "Cgroup", messages: [{ type: "text", text: "[P1] INC-2026-0001" }] });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer line-token");
  });

  it("reports an HTTP failure without the token or response body", async () => {
    const channel = createLineChannel({
      accessToken: "line-token",
      to: "Cgroup",
      fetchImpl: (async () => new Response("invalid token line-token", { status: 401 })) as unknown as typeof fetch,
    });
    const error = await channel.send("x").catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("LINE HTTP 401");
  });
});

describe("Email channel", () => {
  it("uses the first line as the subject", async () => {
    const sent: unknown[] = [];
    const channel = createEmailChannel(
      { host: "smtp", port: 587, from: "soc@hospital.example", to: ["it@hospital.example"] },
      { sendMail: async (m) => sent.push(m) },
    );
    await channel.send("[P2] INC-2026-0002\nตรวจพบ: ...");
    expect(sent[0]).toMatchObject({ subject: "[P2] INC-2026-0002", to: ["it@hospital.example"] });
  });

  it("fails cleanly when the SMTP server is unreachable", async () => {
    const channel = createEmailChannel({
      host: "127.0.0.1",
      port: 1,
      user: "svc-notify",
      password: "smtp-password",
      from: "soc@hospital.example",
      to: ["it@hospital.example"],
    });
    const error = (await channel.send("x").catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/^SMTP ส่งไม่สำเร็จ/);
    expect(error.message).not.toContain("smtp-password");
  });
});
