"use client";

import { useActionState } from "react";
import { sendTestAction, type TestSendState } from "./actions";

export function TestSendButton({ csrf, channel }: { csrf: string; channel: "EMAIL" | "LINE" }) {
  const [state, action, pending] = useActionState<TestSendState, FormData>(sendTestAction, {});
  return (
    <form action={action} className="row">
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="channel" value={channel} />
      <button className="secondary sm" type="submit" disabled={pending}>
        {pending ? "กำลังส่ง..." : "ส่งข้อความทดสอบ"}
      </button>
      {state.message && (
        <span role="status" className={state.ok ? "state-ok" : "error"}>
          {state.message}
        </span>
      )}
    </form>
  );
}
