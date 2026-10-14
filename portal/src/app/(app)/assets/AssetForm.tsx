"use client";

import { useActionState } from "react";
import { saveAssetAction, type AssetFormState } from "./actions";

export function AssetForm({ csrf }: { csrf: string }) {
  const [state, action, pending] = useActionState<AssetFormState, FormData>(saveAssetAction, {});
  return (
    <form className="stack" action={action}>
      <input type="hidden" name="csrf" value={csrf} />
      <label>
        ชื่อ (A-Z a-z 0-9 . _ -)
        <input name="name" required />
      </label>
      <label>
        หน้าที่ของระบบ
        <input name="role" required />
      </label>
      <label>
        ผู้รับผิดชอบ
        <input name="owner" required />
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" name="critical" /> เป็น Critical Asset
      </label>
      <label>
        เหตุผล (จำเป็นเมื่อเป็น Critical Asset)
        <input name="criticalReason" />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.ok && <p className="state-ok" role="status">บันทึกแล้ว</p>}
      <button type="submit" disabled={pending}>
        เพิ่ม asset
      </button>
    </form>
  );
}
