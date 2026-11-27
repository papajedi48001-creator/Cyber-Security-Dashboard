# Portal visual redesign: the triage board

Date: 2026-11-25. Status: Proposed, built on the PR that enables the `frontend-design` skill.

Scope: the look, layout and page structure of the Security Operations Portal. It does not change routes, permissions, server actions, data or wording that tests depend on. Every hard boundary in `CLAUDE.md` still applies.

## Brief

- **Subject:** the Security Operations Portal of Waritchaphum Hospital, a community hospital.
- **Audience:** a small IT team (Security Operators and Security Administrators) on the management network, plus Executive Viewers who read summaries.
- **Primary job:** answer two questions on every visit: what needs me now, and what can I not see right now.

## Concept

A hospital already has a visual language for "what needs attention first": the emergency department triage board. Staff read it at a glance and trust its colours. The Portal borrows it:

- Every monitored area (Security Incidents, Log Source Health, Backup Evidence, External Port Exposure, WAF, Duo, notifications) gets one **triage level**: ต้องดำเนินการ (act), ควรตรวจ (check), ไม่ทราบสถานะ (unknown) or ปกติ (ok).
- **Unknown is never green.** Like a monitor with a lead off, an area with missing or stale data shows a hatched "no reading" pattern, not a calm colour. This draws the `CLAUDE.md` rule "missing or stale source data must render as stale/unavailable" right into the design.
- Colour is never the only signal: every level also has a word and a glyph (✕ act, ! check, ? unknown, ✓ ok).

The mapping from data to triage level lives in `portal/src/lib/ui/triage.ts` with unit tests, so the rule is checked by tests rather than left to page markup.

## Tokens

### Colour

| Name | Hex | Role |
| --- | --- | --- |
| Ward wall | `#E8EEEC` | Page background, a pale celadon grey |
| Chart paper | `#FBFCFB` | Panels and tables |
| Ink | `#1B2A33` | Text; deep slate blue, not a tinted black |
| Scrub teal | `#0F6E6A` | Links, primary buttons, current page in the navigation |
| Scrub teal deep | `#0B3B3A` | Navigation rail |
| Triage red | `#B3261E` | Act, P1 |
| Triage orange | `#B8520A` | P2 |
| Triage yellow | `#E5B323` fill with ink text | Check, P3 |
| Stable green | `#2F7D4A` | Ok |
| No reading | `#64727B` and hatching | Unknown |

### Type

- One family: **IBM Plex Sans Thai Looped** (OFL), self-hosted through `@fontsource`, so the browser makes no request outside the hospital network. Its looped Thai letterforms read like official Thai forms and stay legible at small sizes, where loopless Thai fonts blur on hospital monitors.
- Scale (ratio 1.25 from 15 px body): 13, 15, 19, 24, 30 px. Weights 400 and 600 only. Numbers use tabular figures.
- No all-caps labels, no monospace for data labels.

### Layout

```
┌──────────┬──────────────────────────────────────────────┐
│ rail     │ ภาพรวม                                       │
│ เฝ้าระวัง │ ┌────────────┬────────────┬────────────┐     │
│  ภาพรวม  │ │▌Incident   │▌แหล่ง Log   │▒Backup     │ ← board: coloured
│  Incident│ │ ต้องดำเนินการ│ ปกติ        │ ไม่ทราบสถานะ │   edge per level,
│  แหล่ง Log│ └────────────┴────────────┴────────────┘     hatch = unknown
│ หลักฐาน   │ ต้องดำเนินการ (queue table)                    │
│  ...     │ Incident ที่ยังไม่ปิด by severity                 │
└──────────┴──────────────────────────────────────────────┘
```

- A dark teal navigation rail on the left, grouped by purpose: เฝ้าระวัง (monitor), หลักฐาน (evidence), รายงาน (report), ดูแลระบบ (administer). Below 900 px the rail becomes a top bar with a horizontally scrolling link row.
- Content is left aligned, max 1180 px wide. Tables keep their own horizontal scroll.
- Record forms sit in a two-column grid under a "บันทึกข้อมูล" heading on wide screens, one column on phones, so tables come first.

## Principles

1. The triage board on the overview is the one bold element. Tables, forms and other pages stay quiet: flat panels, hairline borders, no shadows, no gradients.
2. Unknown is never green, and colour never stands alone.
3. Severity P1 to P4 uses the triage colours everywhere it appears, as a solid tag.
4. The interface names things by what staff do, in Thai first, using the terms in `CONTEXT.md`.

## Review against generic defaults

The `frontend-design` skill asks to check the plan against common generated looks. Changes made after review:

- First draft used a near-black "SOC" theme with a bright accent. That is a known default and wrong for a hospital day-shift team on shared monitors, so it became the ward-wall light theme.
- First draft drew the board as identical rounded cards with shadows (the SaaS card kit). The board now uses flat tiles with a thick left edge in the triage colour, and only the board uses that device.
- First draft used a monospace face for timestamps. Dropped; tabular figures in the main family do the job.

## Not changed

- Routes, permissions, server actions, CSRF handling and audit behaviour.
- Labels, button names, `role` attributes and table structure used by the Playwright flows.
- No restore, delete or backup-command controls are added.
