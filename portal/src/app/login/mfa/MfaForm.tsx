"use client";

import { useActionState } from "react";
import { completeMfaAction, type MfaState } from "./actions";

export function MfaForm() {
  const [state, action, pending] = useActionState<MfaState, FormData>(completeMfaAction, {});
  return (
    <form className="stack" action={action}>
      <label>
        รหัส MFA 6 หลัก
        <input name="totp" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" required autoFocus />
      </label>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        ยืนยัน
      </button>
    </form>
  );
}
