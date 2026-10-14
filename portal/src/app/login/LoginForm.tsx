"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form className="stack" action={action}>
      <label>
        ชื่อผู้ใช้
        <input name="username" autoComplete="username" required />
      </label>
      <label>
        รหัสผ่าน
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <label>
        รหัส MFA 6 หลัก
        <input name="totp" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" required />
      </label>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        เข้าสู่ระบบ
      </button>
    </form>
  );
}
