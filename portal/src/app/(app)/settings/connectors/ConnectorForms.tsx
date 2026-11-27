"use client";

import { useActionState } from "react";
import { saveConnectorAction, testConnectorAction, type ConnectorFormState } from "./actions";

interface Props {
  csrf: string;
  name: string;
  targetLabel: string;
  usernameLabel: string | null;
  secretLabel: string;
  target: string | null;
  username: string | null;
  secretSet: boolean;
  disabled: boolean;
}

function Result({ state }: { state: ConnectorFormState }) {
  if (!state.message) return null;
  return (
    <span role="status" className={state.ok ? "state-ok" : "error"}>
      {state.message}
    </span>
  );
}

export function ConnectorForm(props: Props) {
  const [saved, save, saving] = useActionState<ConnectorFormState, FormData>(saveConnectorAction, {});
  const [tested, test, testing] = useActionState<ConnectorFormState, FormData>(testConnectorAction, {});
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <form className="stack" action={save}>
        <input type="hidden" name="csrf" value={props.csrf} />
        <input type="hidden" name="name" value={props.name} />
        <fieldset disabled={props.disabled} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}>
          <label>
            {props.targetLabel}
            <input name="target" required defaultValue={props.target ?? ""} autoComplete="off" />
          </label>
          {props.usernameLabel && (
            <label>
              {props.usernameLabel}
              <input name="username" required defaultValue={props.username ?? ""} autoComplete="off" />
            </label>
          )}
          <label>
            {props.secretLabel}
            <input
              name="secret"
              type="password"
              autoComplete="new-password"
              placeholder={props.secretSet ? "ตั้งค่าแล้ว เว้นว่างเพื่อใช้ค่าเดิม" : "ยังไม่ได้ตั้ง"}
            />
          </label>
          <div className="row">
            <button type="submit" disabled={saving}>
              {saving ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <Result state={saved} />
          </div>
        </fieldset>
      </form>
      <form action={test} className="row">
        <input type="hidden" name="csrf" value={props.csrf} />
        <input type="hidden" name="name" value={props.name} />
        <button className="secondary sm" type="submit" disabled={testing}>
          {testing ? "กำลังทดสอบ..." : "ทดสอบการเชื่อมต่อ"}
        </button>
        <Result state={tested} />
      </form>
    </div>
  );
}
