"use client";

import { useActionState } from "react";
import { createUserAction, linkProviderIdAction, resetMfaAction, type EnrollmentState, type LinkState } from "./actions";

function EnrollmentResult({ state }: { state: EnrollmentState }) {
  if (state.error)
    return (
      <p className="error" role="alert">
        {state.error}
      </p>
    );
  if (!state.otpauthUri) return null;
  const secret = new URL(state.otpauthUri).searchParams.get("secret");
  return (
    <div className="card" role="status">
      <p>
        ให้ <strong>{state.username}</strong> ลงทะเบียนแอป Authenticator ด้วยรหัสนี้ ข้อมูลนี้แสดงครั้งเดียว ห้ามบันทึกหรือส่งต่อผ่านช่องทางที่ไม่ปลอดภัย
      </p>
      <p>
        Secret: <code>{secret}</code>
      </p>
      <p className="muted" style={{ wordBreak: "break-all" }}>
        {state.otpauthUri}
      </p>
    </div>
  );
}

export function CreateUserForm({ csrf }: { csrf: string }) {
  const [state, action, pending] = useActionState<EnrollmentState, FormData>(createUserAction, {});
  return (
    <>
      <form className="stack" action={action}>
        <input type="hidden" name="csrf" value={csrf} />
        <label>
          ชื่อผู้ใช้
          <input name="username" required pattern="[a-z0-9._\-]{3,64}" />
        </label>
        <label>
          ชื่อที่แสดง
          <input name="displayName" required />
        </label>
        <label>
          บทบาท
          <select name="role" defaultValue="SECURITY_OPERATOR">
            <option value="SECURITY_OPERATOR">Security Operator</option>
            <option value="SECURITY_ADMINISTRATOR">Security Administrator</option>
            <option value="EXECUTIVE_VIEWER">Executive Viewer</option>
          </select>
        </label>
        <label>
          รหัสผ่านเริ่มต้น (อย่างน้อย 12 ตัวอักษร)
          <input name="password" type="password" minLength={12} required autoComplete="new-password" />
        </label>
        <button type="submit" disabled={pending}>
          สร้างผู้ใช้
        </button>
      </form>
      <EnrollmentResult state={state} />
    </>
  );
}

export function ResetMfaForm({ csrf, userId }: { csrf: string; userId: string }) {
  const [state, action, pending] = useActionState<EnrollmentState, FormData>(resetMfaAction, {});
  return (
    <>
      <form action={action}>
        <input type="hidden" name="csrf" value={csrf} />
        <input type="hidden" name="userId" value={userId} />
        <button className="secondary" type="submit" disabled={pending}>
          รีเซ็ต MFA
        </button>
      </form>
      <EnrollmentResult state={state} />
    </>
  );
}

export function LinkProviderIdForm({ csrf, userId }: { csrf: string; userId: string }) {
  const [state, action, pending] = useActionState<LinkState, FormData>(linkProviderIdAction, {});
  return (
    <form action={action} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="userId" value={userId} />
      <input name="providerId" aria-label="Provider ID" placeholder="Provider ID (ไม่ใช่เลขบัตรประชาชน)" required pattern="[A-Za-z0-9._\-]{1,64}" />
      <button className="secondary" type="submit" disabled={pending}>
        ผูก
      </button>
      {state.error && (
        <span className="error" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
