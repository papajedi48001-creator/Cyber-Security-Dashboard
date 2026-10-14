// Notification Summary (spec "Notifications"): Email and LINE OA carry only
// severity, incident number, detection time, affected system name and a Portal
// link. Titles, causes, addresses, usernames and patient data never leave the Portal.

import { formatBangkok } from "../format";
import type { Severity } from "../wazuh/normalize-alert";

export interface NotificationSummary {
  severity: Severity;
  incidentNumber: string;
  detectedAt: Date;
  systemName: string;
  link: string;
}

export interface NotifiableIncident {
  id: string;
  number: string;
  severity: Severity;
  detectedAt: Date;
  sourceName: string | null;
}

const UNNAMED = "ไม่ระบุ";
const SAFE_SYSTEM_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const LOOKS_LIKE_ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$|:/;

export function buildNotificationSummary(incident: NotifiableIncident, portalBaseUrl: string): NotificationSummary {
  const name = incident.sourceName?.trim() ?? "";
  return {
    severity: incident.severity,
    incidentNumber: incident.number,
    detectedAt: incident.detectedAt,
    systemName: SAFE_SYSTEM_NAME.test(name) && !LOOKS_LIKE_ADDRESS.test(name) ? name : UNNAMED,
    link: `${portalBaseUrl.replace(/\/$/, "")}/incidents/${encodeURIComponent(incident.id)}`,
  };
}

export function renderNotificationText(summary: NotificationSummary): string {
  return [
    `[${summary.severity}] ${summary.incidentNumber}`,
    `ตรวจพบ: ${formatBangkok(summary.detectedAt)}`,
    `ระบบ: ${summary.systemName}`,
    `รายละเอียดใน Portal: ${summary.link}`,
  ].join("\n");
}
