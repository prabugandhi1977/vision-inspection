import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, CartesianGrid, Legend, ReferenceLine,
} from "recharts";
import Papa from "papaparse";
import * as XLSX from "xlsx";

/* ============================================================
   DESIGN TOKENS — "Operations Console"
   Cool paper background, ink navy, teal = healthy/profit,
   amber = at risk, brick = delayed/over budget.
   ============================================================ */
const T = {
  bg: "#F4F6F8",
  surface: "#FFFFFF",
  ink: "#101C2E",
  slate: "#4A5A6E",
  faint: "#8A97A8",
  line: "#DDE3EA",
  teal: "#0E7C6B",
  tealSoft: "#E2F1EE",
  amber: "#B8620B",
  amberSoft: "#FBEEDD",
  brick: "#B03A2E",
  brickSoft: "#F9E6E3",
  blue: "#1F5AA6",
  blueSoft: "#E4EDF8",
  display: "'Space Grotesk', 'Segoe UI', sans-serif",
  body: "'Inter', 'Segoe UI', sans-serif",
};

const STATUS = {
  "On Track": { color: T.teal, soft: T.tealSoft },
  "At Risk": { color: T.amber, soft: T.amberSoft },
  "Delayed": { color: T.brick, soft: T.brickSoft },
  "Completed": { color: T.blue, soft: T.blueSoft },
};

const TASK_STATUS = {
  "To Do": { color: T.slate, soft: "#EDF0F4" },
  "In Progress": { color: T.blue, soft: T.blueSoft },
  "Blocked": { color: T.brick, soft: T.brickSoft },
  "Done": { color: T.teal, soft: T.tealSoft },
};
const PRIORITY = {
  High: { color: T.brick },
  Medium: { color: T.amber },
  Low: { color: T.slate },
};

const BOM_STATUS = {
  "Draft": { color: T.slate, soft: "#EDF0F4" },
  "Released": { color: T.teal, soft: T.tealSoft },
  "Revised": { color: T.blue, soft: T.blueSoft },
  "On Hold": { color: T.amber, soft: T.amberSoft },
};
const DELIVERY_STATUS = {
  "Pending": { color: T.slate, soft: "#EDF0F4" },
  "Ordered": { color: T.blue, soft: T.blueSoft },
  "Partially Delivered": { color: T.amber, soft: T.amberSoft },
  "Delivered": { color: T.teal, soft: T.tealSoft },
};

const DEFAULT_DEPARTMENTS = ["Operations", "Engineering", "Sales", "Marketing", "Finance"];
const DEFAULT_VERTICALS = ["Manufacturing", "Services", "Trading"];
const PAYMENT_KIND = ["Inflow", "Outflow"];
const PAYMENT_STATUS = ["Pending", "Paid"];
const RISK_STATUS = ["Open", "Mitigating", "Closed"];
const ISSUE_TYPE = ["Issue", "Change Request"];
const ISSUE_STATUS = ["Open", "Approved", "Rejected", "Closed"];
const INSPECTION_STATUS = {
  "Not Inspected": { color: T.slate, soft: "#EDF0F4" },
  "Passed": { color: T.teal, soft: T.tealSoft },
  "Rework": { color: T.amber, soft: T.amberSoft },
  "Rejected": { color: T.brick, soft: T.brickSoft },
};
const STORAGE_KEY = "portfolio-tracker-data-v2";

/* ============================================================
   SAMPLE DATA (loaded only when storage is empty)
   ============================================================ */
const SAMPLE_PROJECTS = [
  { id: "p1", name: "Warehouse Automation Rollout", department: "Operations", vertical: "Manufacturing", owner: "Priya N", status: "On Track", startDate: "2026-03-01", endDate: "2026-09-30", baselineStart: "2026-03-01", baselineEnd: "2026-09-15", percentComplete: 55, teamSize: 8, hoursAllocated: 3200, hoursUsed: 1700, budget: 4500000, actualCost: 2400000, committedCost: 800000, retention: 360000, revenue: 7200000, cashIn: 0, cashOut: 2500000, payments: [
    { id: "pay1", label: "Advance (30%)", date: "2026-03-15", amount: 2160000, kind: "Inflow", status: "Paid", invoiceNo: "INV-2026-041" },
    { id: "pay2", label: "Milestone 1 (25%)", date: "2026-06-20", amount: 1800000, kind: "Inflow", status: "Paid", invoiceNo: "INV-2026-089" },
    { id: "pay3", label: "Milestone 2 (25%)", date: "2026-08-15", amount: 1800000, kind: "Inflow", status: "Pending", invoiceNo: "INV-2026-112" },
  ],
    milestones: [
      { id: "m1", label: "Design freeze", planned: "2026-04-15", actual: "2026-04-18" },
      { id: "m2", label: "Line B commissioning", planned: "2026-07-25", actual: "" },
      { id: "m3", label: "Go-live", planned: "2026-09-20", actual: "" },
    ],
    risks: [
      { id: "r1", title: "PLC vendor lead-time slip", owner: "Rahul T", probability: 4, impact: 4, mitigation: "Alternate vendor qualified; buffer stock ordered", status: "Mitigating" },
      { id: "r2", title: "Power augmentation delay from utility", owner: "Priya N", probability: 2, impact: 5, mitigation: "Genset backup plan approved", status: "Open" },
    ],
    issues: [
      { id: "i1", date: "2026-06-05", title: "Client requested extra safety interlocks", type: "Change Request", costImpact: 350000, timeImpact: 10, status: "Approved" },
    ],
    updates: [
      { id: "u1", date: "2026-07-06", by: "Priya N", note: "Line B mechanical install 80% done. PLC delivery is the watch item — expected 28 Jul." },
    ] },
  { id: "p2", name: "Customer Portal v2", department: "Engineering", vertical: "Services", owner: "Arjun M", status: "At Risk", startDate: "2026-02-15", endDate: "2026-08-15", baselineStart: "2026-02-15", baselineEnd: "2026-07-15", percentComplete: 48, teamSize: 6, hoursAllocated: 2800, hoursUsed: 1900, budget: 3800000, actualCost: 2950000, committedCost: 600000, retention: 0, revenue: 6000000, cashIn: 1800000, cashOut: 3000000, payments: [],
    milestones: [
      { id: "m4", label: "Beta release", planned: "2026-06-30", actual: "" },
      { id: "m5", label: "UAT sign-off", planned: "2026-07-30", actual: "" },
    ],
    risks: [
      { id: "r3", title: "Load-time regression blocks UAT", owner: "Sneha V", probability: 3, impact: 4, mitigation: "Perf sprint scheduled wk 29", status: "Open" },
    ],
    issues: [
      { id: "i2", date: "2026-06-22", title: "SSO scope added for enterprise client", type: "Change Request", costImpact: 280000, timeImpact: 15, status: "Open" },
    ],
    updates: [
      { id: "u2", date: "2026-07-04", by: "Arjun M", note: "Beta slipped 2 weeks due to perf issues. Need decision on SSO change request cost pass-through." },
    ] },
  { id: "p3", name: "Enterprise Account Expansion", department: "Sales", vertical: "Services", owner: "Kavya R", status: "On Track", startDate: "2026-04-01", endDate: "2026-12-15", percentComplete: 30, teamSize: 5, hoursAllocated: 2000, hoursUsed: 620, budget: 1500000, actualCost: 450000, revenue: 9500000, cashIn: 0, cashOut: 500000, payments: [
    { id: "pay4", label: "Retainer Q2", date: "2026-04-10", amount: 2400000, kind: "Inflow", status: "Paid" },
    { id: "pay5", label: "Retainer Q3", date: "2026-07-05", amount: 2400000, kind: "Inflow", status: "Pending" },
  ] },
  { id: "p4", name: "Brand Refresh Campaign", department: "Marketing", vertical: "Trading", owner: "Dev S", status: "Delayed", startDate: "2026-01-10", endDate: "2026-06-30", percentComplete: 62, teamSize: 4, hoursAllocated: 1600, hoursUsed: 1550, budget: 2200000, actualCost: 2600000, revenue: 3100000, cashIn: 900000, cashOut: 2650000, payments: [] },
  { id: "p5", name: "ERP Cost Module Upgrade", department: "Finance", vertical: "Manufacturing", owner: "Meera K", status: "Completed", startDate: "2025-11-01", endDate: "2026-04-30", percentComplete: 100, teamSize: 3, hoursAllocated: 1200, hoursUsed: 1150, budget: 1800000, actualCost: 1700000, revenue: 2600000, cashIn: 2600000, cashOut: 1700000, payments: [] },
  { id: "p6", name: "Vendor Consolidation Program", department: "Operations", vertical: "Manufacturing", owner: "Rahul T", status: "At Risk", startDate: "2026-05-01", endDate: "2026-10-31", percentComplete: 20, teamSize: 4, hoursAllocated: 1400, hoursUsed: 380, budget: 1200000, actualCost: 520000, revenue: 2000000, cashIn: 300000, cashOut: 540000, payments: [] },
];

const EMPTY_PROJECT = {
  name: "", department: DEFAULT_DEPARTMENTS[0], vertical: "", owner: "", status: "On Track",
  startDate: "", endDate: "", baselineStart: "", baselineEnd: "", percentComplete: 0, teamSize: 1,
  hoursAllocated: 0, hoursUsed: 0, budget: 0, actualCost: 0, committedCost: 0, retention: 0,
  revenue: 0, cashIn: 0, cashOut: 0, payments: [], milestones: [], risks: [], issues: [], updates: [],
};

const SAMPLE_TASKS = [
  { id: "t1", title: "Commission conveyor line B", department: "Operations", projectId: "p1", assignee: "Priya N", startDate: "2026-07-01", dueDate: "2026-07-20", priority: "High", status: "In Progress", cost: 180000, estHours: 90, dependsOn: "" },
  { id: "t2", title: "Vendor SLA renegotiation — top 5", department: "Operations", projectId: "p6", assignee: "Rahul T", startDate: "2026-06-15", dueDate: "2026-07-05", priority: "High", status: "Blocked", cost: 40000, estHours: 30, dependsOn: "" },
  { id: "t3", title: "API integration testing", department: "Engineering", projectId: "p2", assignee: "Arjun M", startDate: "2026-07-01", dueDate: "2026-07-15", priority: "High", status: "In Progress", cost: 95000, estHours: 60, dependsOn: "" },
  { id: "t4", title: "Fix portal load-time regression", department: "Engineering", projectId: "p2", assignee: "Sneha V", startDate: "2026-07-18", dueDate: "2026-07-25", priority: "Medium", status: "To Do", cost: 30000, estHours: 24, dependsOn: "t3" },
  { id: "t5", title: "Q3 enterprise pipeline review", department: "Sales", projectId: "p3", assignee: "Kavya R", startDate: "2026-07-08", dueDate: "2026-07-12", priority: "Medium", status: "To Do", cost: 0, estHours: 8, dependsOn: "" },
  { id: "t6", title: "Finalize campaign creative round 2", department: "Marketing", projectId: "p4", assignee: "Dev S", startDate: "2026-06-10", dueDate: "2026-06-28", priority: "High", status: "In Progress", cost: 220000, estHours: 50, dependsOn: "" },
  { id: "t7", title: "Close ERP module UAT sign-off", department: "Finance", projectId: "p5", assignee: "Meera K", startDate: "2026-04-15", dueDate: "2026-04-25", priority: "Low", status: "Done", cost: 15000, estHours: 12, dependsOn: "" },
];

const EMPTY_TASK = {
  title: "", department: DEFAULT_DEPARTMENTS[0], projectId: "", assignee: "",
  startDate: "", dueDate: "", priority: "Medium", status: "To Do", cost: 0, estHours: 0, dependsOn: "",
};

const CSV_TEMPLATE = "title,department,project,assignee,startDate,dueDate,priority,status,cost,estHours\nPrepare vendor shortlist,Operations,Warehouse Automation Rollout,Priya N,2026-07-20,2026-08-01,High,To Do,50000,16\nDraft launch email,Marketing,,Dev S,2026-07-25,2026-07-30,Medium,In Progress,0,4";

const SAMPLE_BOMS = [
  { id: "b1", bomNo: "BOM-2026-014", title: "Conveyor drive assembly", projectId: "p1", revision: "B", releasedBy: "Arjun M", releaseDate: "2026-05-12", releaseStatus: "Released", items: 42, vendor: "Kirloskar Systems", estCost: 1250000, actualCost: 1310000, deliveryStatus: "Partially Delivered", expectedDelivery: "2026-07-05", actualDelivery: "", inspectionStatus: "Rework", rejectionPct: 4, reworkCost: 35000 },
  { id: "b2", bomNo: "BOM-2026-018", title: "Portal server hardware kit", projectId: "p2", revision: "A", releasedBy: "Sneha V", releaseDate: "2026-06-02", releaseStatus: "Released", items: 15, vendor: "Redington", estCost: 680000, actualCost: 655000, deliveryStatus: "Delivered", expectedDelivery: "2026-06-25", actualDelivery: "2026-06-23", inspectionStatus: "Passed", rejectionPct: 0, reworkCost: 0 },
  { id: "b3", bomNo: "BOM-2026-021", title: "Sensor + PLC retrofit pack", projectId: "p1", revision: "A", releasedBy: "Arjun M", releaseDate: "2026-06-20", releaseStatus: "Released", items: 28, vendor: "Siemens Partner Co", estCost: 940000, actualCost: 0, deliveryStatus: "Ordered", expectedDelivery: "2026-07-28", actualDelivery: "", inspectionStatus: "Not Inspected", rejectionPct: 0, reworkCost: 0 },
  { id: "b4", bomNo: "BOM-2026-025", title: "Packaging line spares", projectId: "p6", revision: "A", releasedBy: "Rahul T", releaseDate: "", releaseStatus: "Draft", items: 12, vendor: "", estCost: 210000, actualCost: 0, deliveryStatus: "Pending", expectedDelivery: "", actualDelivery: "", inspectionStatus: "Not Inspected", rejectionPct: 0, reworkCost: 0 },
];

const EMPTY_BOM = {
  bomNo: "", title: "", projectId: "", revision: "A", releasedBy: "",
  releaseDate: "", releaseStatus: "Draft", items: 0, vendor: "",
  estCost: 0, actualCost: 0, deliveryStatus: "Pending", expectedDelivery: "", actualDelivery: "",
  inspectionStatus: "Not Inspected", rejectionPct: 0, reworkCost: 0,
};

const BOM_CSV_TEMPLATE = "bomNo,title,project,revision,releasedBy,releaseDate,releaseStatus,items,vendor,estCost,actualCost,deliveryStatus,expectedDelivery,actualDelivery,inspectionStatus,rejectionPct,reworkCost\nBOM-2026-030,Hydraulic valve set,Warehouse Automation Rollout,A,Arjun M,2026-07-15,Released,18,ABC Vendors,450000,0,Ordered,2026-08-10,,Not Inspected,0,0";

const PROJECT_CSV_TEMPLATE = "name,department,vertical,owner,status,startDate,endDate,baselineStart,baselineEnd,percentComplete,teamSize,hoursAllocated,hoursUsed,budget,actualCost,committedCost,retention,revenue,cashIn,cashOut\nPlant Capacity Expansion,Operations,Manufacturing,Priya N,On Track,2026-08-01,2027-02-28,2026-08-01,2027-02-28,0,10,4000,0,8500000,0,1200000,0,12500000,0,0";

/* ============================================================
   HELPERS
   ============================================================ */
const CURRENCIES = { "₹": "en-IN", "$": "en-US", "€": "de-DE", "£": "en-GB" };

function fmtMoney(v, symbol) {
  const locale = CURRENCIES[symbol] || "en-US";
  const abs = Math.abs(v);
  let compact;
  if (locale === "en-IN") {
    if (abs >= 1e7) compact = (v / 1e7).toFixed(2).replace(/\.00$/, "") + " Cr";
    else if (abs >= 1e5) compact = (v / 1e5).toFixed(1).replace(/\.0$/, "") + " L";
    else compact = new Intl.NumberFormat(locale).format(Math.round(v));
  } else {
    compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(v);
  }
  return symbol + compact;
}

const pct = (v) => (isFinite(v) ? Math.round(v * 10) / 10 + "%" : "—");
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function derived(p) {
  const pays = p.payments || [];
  const paidIn = pays.filter((x) => x.kind === "Inflow" && x.status === "Paid").reduce((s, x) => s + (x.amount || 0), 0);
  const paidOut = pays.filter((x) => x.kind === "Outflow" && x.status === "Paid").reduce((s, x) => s + (x.amount || 0), 0);
  const pendIn = pays.filter((x) => x.kind === "Inflow" && x.status === "Pending").reduce((s, x) => s + (x.amount || 0), 0);
  const pendOut = pays.filter((x) => x.kind === "Outflow" && x.status === "Pending").reduce((s, x) => s + (x.amount || 0), 0);
  const cashIn = (p.cashIn || 0) + paidIn;
  const cashOut = (p.cashOut || 0) + paidOut;
  const variance = p.budget > 0 ? ((p.actualCost - p.budget) / p.budget) * 100 : 0;
  const fcf = cashIn - cashOut;
  const margin = p.revenue > 0 ? ((p.revenue - p.actualCost) / p.revenue) * 100 : 0;
  const util = p.hoursAllocated > 0 ? (p.hoursUsed / p.hoursAllocated) * 100 : 0;
  // ROI on incurred cost; payback = months until cumulative inflows cover cost
  const roi = p.actualCost > 0 ? ((p.revenue - p.actualCost) / p.actualCost) * 100 : null;
  let payback = null;
  if (p.actualCost > 0 && p.startDate && fcf !== 0) {
    const endRef = p.status === "Completed" && p.endDate ? new Date(p.endDate) : new Date();
    const monthsElapsed = Math.max(0.5, (endRef - new Date(p.startDate)) / (30.44 * 86400000));
    const inflowPerMonth = cashIn / monthsElapsed;
    if (inflowPerMonth > 0) payback = p.actualCost / inflowPerMonth;
  }
  // Slippage vs baseline (days, +ve = later than baseline)
  const slippage = p.baselineEnd && p.endDate ? dayDiff(p.baselineEnd, p.endDate) : null;
  const totalCommitted = (p.actualCost || 0) + (p.committedCost || 0);
  return { variance, fcf, margin, util, paidIn, paidOut, pendIn, pendOut, cashIn, cashOut, roi, payback, slippage, totalCommitted };
}

function expectedProgress(p) {
  if (!p.startDate || !p.endDate) return null;
  const s = new Date(p.startDate).getTime();
  const e = new Date(p.endDate).getTime();
  const now = Date.now();
  if (e <= s) return null;
  return Math.min(100, Math.max(0, ((now - s) / (e - s)) * 100));
}

function buildAlerts(projects, marginTarget) {
  const alerts = [];
  const today = new Date(new Date().toDateString());
  projects.forEach((p) => {
    const d = derived(p);
    if (p.status !== "Completed") {
      if (d.variance > 0) alerts.push({ id: p.id + "-b", project: p.name, dept: p.department, type: "Over budget", detail: `Spend is ${pct(d.variance)} above budget`, sev: "brick" });
      const exp = expectedProgress(p);
      if (exp !== null && exp - p.percentComplete > 15) alerts.push({ id: p.id + "-s", project: p.name, dept: p.department, type: "Behind schedule", detail: `${Math.round(exp - p.percentComplete)} pts behind expected progress`, sev: "amber" });
      if (d.fcf < 0) alerts.push({ id: p.id + "-f", project: p.name, dept: p.department, type: "Negative FCF", detail: `Cash outflow exceeds inflow`, sev: "amber" });
    }
    if (p.revenue > 0 && d.margin < marginTarget) alerts.push({ id: p.id + "-m", project: p.name, dept: p.department, type: "Below margin target", detail: `Net margin ${pct(d.margin)} vs ${marginTarget}% target`, sev: "amber" });
    if (p.status !== "Completed" && p.budget > 0 && d.totalCommitted > p.budget) alerts.push({ id: p.id + "-cm", project: p.name, dept: p.department, type: "Commitments exceed budget", detail: `Actual + committed cost is ${pct(((d.totalCommitted - p.budget) / p.budget) * 100)} over budget`, sev: "brick" });
    (p.milestones || []).forEach((m) => {
      if (!m.actual && m.planned && new Date(m.planned) < today) alerts.push({ id: p.id + "-ms-" + m.id, project: p.name, dept: p.department, type: "Milestone overdue", detail: `"${m.label}" was planned for ${m.planned}`, sev: "brick" });
    });
    (p.risks || []).forEach((r) => {
      const score = (r.probability || 0) * (r.impact || 0);
      if (r.status !== "Closed" && score >= 15) alerts.push({ id: p.id + "-rk-" + r.id, project: p.name, dept: p.department, type: "High risk open", detail: `"${r.title}" · score ${score}/25 (${r.status})`, sev: "amber" });
    });
    (p.payments || []).forEach((pay) => {
      if (pay.status === "Pending" && pay.date && new Date(pay.date) < today) {
        const aging = dayDiff(pay.date, today);
        alerts.push({ id: p.id + "-pay-" + pay.id, project: p.name, dept: p.department, type: pay.kind === "Inflow" ? "Payment overdue (receivable)" : "Payment overdue (payable)", detail: `${pay.label || "Part payment"}${pay.invoiceNo ? ` · ${pay.invoiceNo}` : ""} due ${pay.date} · ${aging} d overdue`, sev: pay.kind === "Inflow" ? "brick" : "amber" });
      }
    });
  });
  return alerts;
}

/* ============================================================
   SMALL UI PIECES
   ============================================================ */
function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS["On Track"];
  return (
    <span style={{ background: s.soft, color: s.color, fontFamily: T.body, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap", letterSpacing: 0.2 }}>
      {status}
    </span>
  );
}

function ProgressBar({ value, color, expected }) {
  return (
    <div style={{ position: "relative", height: 8, background: T.line, borderRadius: 4, overflow: "hidden", minWidth: 70 }}>
      <div style={{ width: `${Math.min(100, value)}%`, height: "100%", background: color, borderRadius: 4, transition: "width .4s" }} />
      {expected !== null && expected !== undefined && (
        <div title="Expected progress by today" style={{ position: "absolute", left: `${Math.min(100, expected)}%`, top: -1, width: 2, height: 10, background: T.ink, opacity: 0.55 }} />
      )}
    </div>
  );
}

function KPI({ label, value, sub, accent }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: "14px 16px", flex: "1 1 150px", minWidth: 140 }}>
      <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontFamily: T.display, fontSize: 26, fontWeight: 700, color: accent || T.ink, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontFamily: T.body, fontSize: 12, color: T.slate, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* Signature element: portfolio health strip — one segment per project,
   width ∝ budget, color = status. The whole portfolio in one glance. */
function HealthStrip({ projects, currency, onSelect }) {
  const total = projects.reduce((s, p) => s + (p.budget || 0), 0) || 1;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink }}>Portfolio health · budget-weighted</div>
        <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>Each block = one project · width = share of total budget · click to open</div>
      </div>
      <div style={{ display: "flex", height: 34, borderRadius: 8, overflow: "hidden", gap: 2 }}>
        {projects.map((p) => {
          const s = STATUS[p.status] || STATUS["On Track"];
          const w = Math.max(3, ((p.budget || 0) / total) * 100);
          return (
            <div key={p.id} onClick={() => onSelect(p)}
              title={`${p.name} · ${p.department} · ${fmtMoney(p.budget, currency)} · ${p.status}`}
              style={{ width: `${w}%`, background: s.color, cursor: "pointer", position: "relative", opacity: p.status === "Completed" ? 0.55 : 1 }}>
              <div style={{ position: "absolute", bottom: 0, left: 0, height: "100%", width: `${p.percentComplete}%`, background: "rgba(255,255,255,0.28)" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
        {Object.entries(STATUS).map(([k, v]) => (
          <span key={k} style={{ fontFamily: T.body, fontSize: 11, color: T.slate, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: v.color, display: "inline-block" }} />{k}
          </span>
        ))}
        <span style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>Lighter fill inside a block = % complete</span>
      </div>
    </div>
  );
}

/* Project Gantt: horizontal timeline bars per project with month
   grid, % complete fill, and a "today" marker. */
function Gantt({ projects, onSelect }) {
  const dated = projects.filter((p) => p.startDate && p.endDate && new Date(p.endDate) > new Date(p.startDate));
  if (!dated.length) {
    return <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate }}>Add start and end dates to projects to see the Gantt chart.</div>;
  }
  const min = Math.min(...dated.map((p) => +new Date(p.startDate)));
  const max = Math.max(...dated.map((p) => +new Date(p.endDate)));
  const span = Math.max(1, max - min);
  const pos = (t) => Math.min(100, Math.max(0, ((t - min) / span) * 100));
  const now = Date.now();
  const ticks = [];
  let d = new Date(min); d = new Date(d.getFullYear(), d.getMonth(), 1);
  while (+d <= max) { ticks.push(new Date(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  const monthLabel = (dt) => dt.toLocaleDateString("en-GB", { month: "short", year: ticks.length > 9 ? undefined : "2-digit" });
  const sorted = [...dated].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  return (
    <div>
      {/* month header */}
      <div style={{ display: "flex" }}>
        <div style={{ width: 170, flexShrink: 0 }} />
        <div style={{ position: "relative", flex: 1, height: 20 }}>
          {ticks.map((tk, i) => (
            <span key={i} style={{ position: "absolute", left: `${pos(+tk)}%`, fontFamily: T.body, fontSize: 10, color: T.faint, transform: "translateX(2px)", whiteSpace: "nowrap" }}>{monthLabel(tk)}</span>
          ))}
        </div>
      </div>
      {/* rows */}
      <div style={{ position: "relative" }}>
        {/* month gridlines + today line spanning all rows */}
        <div style={{ position: "absolute", left: 170, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
          {ticks.map((tk, i) => (
            <div key={i} style={{ position: "absolute", left: `${pos(+tk)}%`, top: 0, bottom: 0, width: 1, background: T.line }} />
          ))}
          {now >= min && now <= max && (
            <div title="Today" style={{ position: "absolute", left: `${pos(now)}%`, top: 0, bottom: 0, width: 2, background: T.ink, opacity: 0.6 }} />
          )}
        </div>
        {sorted.map((p) => {
          const s = STATUS[p.status] || STATUS["On Track"];
          const l = pos(+new Date(p.startDate));
          const w = Math.max(1.5, pos(+new Date(p.endDate)) - l);
          const hasBaseline = p.baselineStart && p.baselineEnd && new Date(p.baselineEnd) > new Date(p.baselineStart);
          const bl = hasBaseline ? pos(+new Date(p.baselineStart)) : 0;
          const bw = hasBaseline ? Math.max(1, pos(+new Date(p.baselineEnd)) - bl) : 0;
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", height: 38 }}>
              <div onClick={() => onSelect(p)} title={p.name}
                style={{ width: 170, flexShrink: 0, paddingRight: 10, fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer" }}>
                {p.name}
                <div style={{ fontSize: 10, fontWeight: 400, color: T.faint }}>{p.department}</div>
              </div>
              <div style={{ position: "relative", flex: 1, height: "100%" }}>
                <div onClick={() => onSelect(p)}
                  title={`${p.name}: ${p.startDate} → ${p.endDate} · ${p.percentComplete}% · ${p.status}`}
                  style={{ position: "absolute", left: `${l}%`, width: `${w}%`, top: 8, height: 16, background: s.soft, border: `1px solid ${s.color}`, borderRadius: 4, cursor: "pointer", overflow: "hidden" }}>
                  <div style={{ width: `${p.percentComplete}%`, height: "100%", background: s.color, opacity: 0.85 }} />
                </div>
                {hasBaseline && (
                  <div title={`Baseline: ${p.baselineStart} → ${p.baselineEnd}`}
                    style={{ position: "absolute", left: `${bl}%`, width: `${bw}%`, top: 27, height: 3, background: T.faint, opacity: 0.55, borderRadius: 2 }} />
                )}
                {(p.milestones || []).filter((m) => m.planned).map((m) => {
                  const mp = pos(+new Date(m.actual || m.planned));
                  const late = !m.actual && new Date(m.planned) < new Date();
                  const col = m.actual ? T.teal : late ? T.brick : T.amber;
                  return (
                    <div key={m.id} title={`◆ ${m.label} · planned ${m.planned}${m.actual ? ` · done ${m.actual}` : late ? " · OVERDUE" : ""}`}
                      style={{ position: "absolute", left: `calc(${mp}% - 5px)`, top: 11, width: 10, height: 10, background: col, transform: "rotate(45deg)", border: "1.5px solid #FFF", boxShadow: "0 0 0 1px " + col, cursor: "pointer", zIndex: 2 }}
                      onClick={() => onSelect(p)} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint, marginTop: 8 }}>Solid fill = % complete · ◆ = milestone (teal done, amber upcoming, red overdue) · thin grey bar = baseline plan · dark vertical line = today · click to edit.</div>
    </div>
  );
}

/* Task-level Gantt: tasks grouped under their project, one bar per
   task colored by task status, with the assigned resource on each row. */
function TaskGantt({ tasks, projects, onSelectTask }) {
  const dated = tasks.filter((t) => t.startDate && t.dueDate && new Date(t.dueDate) >= new Date(t.startDate));
  if (!dated.length) {
    return <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate }}>Add start and due dates to tasks to see the task Gantt.</div>;
  }
  const min = Math.min(...dated.map((t) => +new Date(t.startDate)));
  const max = Math.max(...dated.map((t) => +new Date(t.dueDate)));
  const span = Math.max(1, max - min);
  const pos = (t) => Math.min(100, Math.max(0, ((t - min) / span) * 100));
  const now = Date.now();
  const ticks = [];
  let d = new Date(min); d = new Date(d.getFullYear(), d.getMonth(), 1);
  while (+d <= max) { ticks.push(new Date(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  const monthLabel = (dt) => dt.toLocaleDateString("en-GB", { month: "short", year: ticks.length > 9 ? undefined : "2-digit" });

  // Group tasks by project, ordered by project start
  const groups = [];
  const orderedProjects = [...projects].sort((a, b) => new Date(a.startDate || "2100-01-01") - new Date(b.startDate || "2100-01-01"));
  orderedProjects.forEach((p) => {
    const ts = dated.filter((t) => t.projectId === p.id).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    if (ts.length) groups.push({ label: p.name, tasks: ts });
  });
  const loose = dated.filter((t) => !t.projectId || !projects.some((p) => p.id === t.projectId)).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  if (loose.length) groups.push({ label: "No linked project", tasks: loose });

  const LABEL_W = 210;
  return (
    <div>
      <div style={{ display: "flex" }}>
        <div style={{ width: LABEL_W, flexShrink: 0 }} />
        <div style={{ position: "relative", flex: 1, height: 20 }}>
          {ticks.map((tk, i) => (
            <span key={i} style={{ position: "absolute", left: `${pos(+tk)}%`, fontFamily: T.body, fontSize: 10, color: T.faint, transform: "translateX(2px)", whiteSpace: "nowrap" }}>{monthLabel(tk)}</span>
          ))}
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: LABEL_W, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
          {ticks.map((tk, i) => (
            <div key={i} style={{ position: "absolute", left: `${pos(+tk)}%`, top: 0, bottom: 0, width: 1, background: T.line }} />
          ))}
          {now >= min && now <= max && (
            <div title="Today" style={{ position: "absolute", left: `${pos(now)}%`, top: 0, bottom: 0, width: 2, background: T.ink, opacity: 0.6 }} />
          )}
        </div>
        {groups.map((g) => (
          <div key={g.label}>
            <div style={{ display: "flex", alignItems: "center", height: 26 }}>
              <div style={{ width: LABEL_W, flexShrink: 0, fontFamily: T.display, fontSize: 12, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 10 }}>{g.label}</div>
              <div style={{ flex: 1 }} />
            </div>
            {g.tasks.map((t) => {
              const s = TASK_STATUS[t.status] || TASK_STATUS["To Do"];
              const l = pos(+new Date(t.startDate));
              const w = Math.max(1.2, pos(+new Date(t.dueDate)) - l);
              const late = isOverdue(t);
              const dep = t.dependsOn ? tasks.find((x) => x.id === t.dependsOn) : null;
              const depBlocked = dep && dep.status !== "Done" && t.status !== "Done";
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", height: 28 }}>
                  <div onClick={() => onSelectTask(t)} title={t.title}
                    style={{ width: LABEL_W, flexShrink: 0, paddingLeft: 12, paddingRight: 10, cursor: "pointer" }}>
                    <div style={{ fontFamily: T.body, fontSize: 11.5, fontWeight: 600, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
                    <div style={{ fontFamily: T.body, fontSize: 10, color: late ? T.brick : depBlocked ? T.amber : T.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      ◉ {t.assignee || "Unassigned"}{late ? " · overdue" : ""}{dep ? ` · ⛓ waits on "${dep.title}"${depBlocked ? " (not done)" : ""}` : ""}
                    </div>
                  </div>
                  <div style={{ position: "relative", flex: 1, height: "100%" }}>
                    <div onClick={() => onSelectTask(t)}
                      title={`${t.title} · ${t.assignee || "Unassigned"} · ${t.startDate} → ${t.dueDate} · ${t.status}`}
                      style={{ position: "absolute", left: `${l}%`, width: `${w}%`, top: 8, height: 12, background: t.status === "Done" ? s.color : s.soft, border: `1px solid ${late ? T.brick : s.color}`, borderRadius: 3, cursor: "pointer", overflow: "hidden", opacity: t.status === "Done" ? 0.55 : 1 }}>
                      {t.status === "In Progress" && <div style={{ width: "50%", height: "100%", background: s.color, opacity: 0.8 }} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint, marginTop: 8 }}>◉ shows the assigned resource · red border = overdue · dark vertical line = today · click a bar or label to edit the task.</div>
    </div>
  );
}

/* ============================================================
   PROJECT FORM MODAL
   ============================================================ */
function Field({ label, children, span }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: span ? "1 / -1" : "auto" }}>
      <span style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.slate, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  fontFamily: "'Inter','Segoe UI',sans-serif", fontSize: 14, color: "#101C2E",
  border: "1px solid #DDE3EA", borderRadius: 8, padding: "8px 10px", background: "#FFF", outline: "none", width: "100%", boxSizing: "border-box",
};

function ProjectModal({ project, departments, verticals, currency, onSave, onDelete, onDuplicate, onClose }) {
  const [form, setForm] = useState(project ? { payments: [], ...project } : { ...EMPTY_PROJECT, department: departments[0] || "" });
  const [confirmDel, setConfirmDel] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const isNew = !project;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k) => (e) => set(k, e.target.value === "" ? 0 : Number(e.target.value));
  const d = derived(form);

  const pays = form.payments || [];
  const addPay = () => set("payments", [...pays, { id: "pay" + Date.now(), label: "", date: "", amount: 0, kind: "Inflow", status: "Pending", invoiceNo: "" }]);
  const setPay = (id, k, v) => set("payments", pays.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const removePay = (id) => set("payments", pays.filter((x) => x.id !== id));

  // Generic sub-list helpers for milestones / risks / issues / updates
  const list = (key) => form[key] || [];
  const addItem = (key, tpl) => set(key, [...list(key), { id: key.slice(0, 2) + Date.now(), ...tpl }]);
  const setItem = (key, id, k, v) => set(key, list(key).map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const removeItem = (key, id) => set(key, list(key).filter((x) => x.id !== id));
  const captureBaseline = () => { set("baselineStart", form.startDate); setForm((f) => ({ ...f, baselineStart: f.startDate, baselineEnd: f.endDate })); };
  const secTitle = { fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.8 };
  const addBtn = { fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.blue, background: T.blueSoft, border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer" };
  const rmBtn = { border: "none", background: "transparent", color: T.faint, cursor: "pointer", fontSize: 15, padding: "0 4px" };
  const small = { ...inputStyle, fontSize: 13 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,28,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", padding: 22, boxShadow: "0 24px 60px rgba(16,28,46,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontFamily: T.display, fontSize: 19, fontWeight: 700, color: T.ink, margin: 0 }}>{isNew ? "Add project" : "Edit project"}</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 20, color: T.faint, cursor: "pointer" }} aria-label="Close">✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Field label="Project name" span><input style={inputStyle} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g., Plant capacity expansion" /></Field>
          <Field label="Department">
            <select style={inputStyle} value={form.department} onChange={(e) => set("department", e.target.value)}>
              {[...new Set([...departments, form.department])].filter(Boolean).map((dep) => <option key={dep}>{dep}</option>)}
            </select>
          </Field>
          <Field label="Business vertical">
            <select style={inputStyle} value={form.vertical || ""} onChange={(e) => set("vertical", e.target.value)}>
              <option value="">— None —</option>
              {[...new Set([...verticals, form.vertical])].filter(Boolean).map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Owner"><input style={inputStyle} value={form.owner} onChange={(e) => set("owner", e.target.value)} placeholder="Name" /></Field>
          <Field label="Status">
            <select style={inputStyle} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {Object.keys(STATUS).map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="% complete"><input type="number" min="0" max="100" style={inputStyle} value={form.percentComplete} onChange={num("percentComplete")} /></Field>
          <Field label="Start date"><input type="date" style={inputStyle} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
          <Field label="Target end date"><input type="date" style={inputStyle} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
          <Field label="Baseline start"><input type="date" style={inputStyle} value={form.baselineStart || ""} onChange={(e) => set("baselineStart", e.target.value)} /></Field>
          <Field label="Baseline end">
            <div style={{ display: "flex", gap: 6 }}>
              <input type="date" style={inputStyle} value={form.baselineEnd || ""} onChange={(e) => set("baselineEnd", e.target.value)} />
              <button onClick={captureBaseline} title="Copy current start/end dates as the baseline plan"
                style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.slate, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "0 8px", cursor: "pointer", whiteSpace: "nowrap" }}>Capture</button>
            </div>
          </Field>
          <Field label="Team size"><input type="number" min="0" style={inputStyle} value={form.teamSize} onChange={num("teamSize")} /></Field>
          <Field label="Hours allocated"><input type="number" min="0" style={inputStyle} value={form.hoursAllocated} onChange={num("hoursAllocated")} /></Field>
          <Field label="Hours used"><input type="number" min="0" style={inputStyle} value={form.hoursUsed} onChange={num("hoursUsed")} /></Field>
          <Field label={`Budget (${currency})`}><input type="number" min="0" style={inputStyle} value={form.budget} onChange={num("budget")} /></Field>
          <Field label={`Actual cost (${currency})`}><input type="number" min="0" style={inputStyle} value={form.actualCost} onChange={num("actualCost")} /></Field>
          <Field label={`Committed cost — POs raised (${currency})`}><input type="number" min="0" style={inputStyle} value={form.committedCost || 0} onChange={num("committedCost")} /></Field>
          <Field label={`Retention / holdback (${currency})`}><input type="number" min="0" style={inputStyle} value={form.retention || 0} onChange={num("retention")} /></Field>
          <Field label={`Revenue (${currency})`}><input type="number" min="0" style={inputStyle} value={form.revenue} onChange={num("revenue")} /></Field>
          <Field label={`Other cash inflow (${currency})`}><input type="number" min="0" style={inputStyle} value={form.cashIn} onChange={num("cashIn")} /></Field>
          <Field label={`Other cash outflow (${currency})`}><input type="number" min="0" style={inputStyle} value={form.cashOut} onChange={num("cashOut")} /></Field>
        </div>

        {/* Part payments schedule */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "18px 0 8px" }}>
          <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.8 }}>Part payments · schedule with dates</div>
          <button onClick={addPay} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.blue, background: T.blueSoft, border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>+ Add payment</button>
        </div>
        {pays.length === 0 ? (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.faint, padding: "8px 0" }}>No part payments yet. Add advances, milestone payments, or vendor payables with their due dates. Payments marked <b>Paid</b> are added to this project's cash flow automatically.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pays.map((pay) => {
              const late = pay.status === "Pending" && pay.date && new Date(pay.date) < new Date(new Date().toDateString());
              return (
                <div key={pay.id} style={{ display: "grid", gridTemplateColumns: "1.3fr 0.9fr 1fr 0.9fr 0.85fr 0.85fr auto", gap: 6, alignItems: "center", background: late ? T.brickSoft : T.bg, borderRadius: 8, padding: "8px 10px" }}>
                  <input style={small} placeholder="Label (e.g., Advance 30%)" value={pay.label} onChange={(e) => setPay(pay.id, "label", e.target.value)} />
                  <input style={small} placeholder="Invoice #" value={pay.invoiceNo || ""} onChange={(e) => setPay(pay.id, "invoiceNo", e.target.value)} />
                  <input type="date" style={small} value={pay.date} onChange={(e) => setPay(pay.id, "date", e.target.value)} title={late ? `${dayDiff(pay.date, new Date().toISOString().slice(0, 10))} days overdue` : "Due date"} />
                  <input type="number" min="0" style={small} placeholder={`Amount (${currency})`} value={pay.amount || ""} onChange={(e) => setPay(pay.id, "amount", e.target.value === "" ? 0 : Number(e.target.value))} />
                  <select style={small} value={pay.kind} onChange={(e) => setPay(pay.id, "kind", e.target.value)}>
                    {PAYMENT_KIND.map((k) => <option key={k}>{k}</option>)}
                  </select>
                  <select style={small} value={pay.status} onChange={(e) => setPay(pay.id, "status", e.target.value)}>
                    {PAYMENT_STATUS.map((k) => <option key={k}>{k}</option>)}
                  </select>
                  <button onClick={() => removePay(pay.id)} aria-label="Remove payment" style={rmBtn}>✕</button>
                </div>
              );
            })}
            <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.slate, display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span>Received: <b style={{ color: T.teal }}>{fmtMoney(d.paidIn, currency)}</b></span>
              <span>Paid out: <b style={{ color: T.slate }}>{fmtMoney(d.paidOut, currency)}</b></span>
              <span>Pending in: <b style={{ color: d.pendIn > 0 ? T.amber : T.slate }}>{fmtMoney(d.pendIn, currency)}</b></span>
              <span>Pending out: <b style={{ color: T.slate }}>{fmtMoney(d.pendOut, currency)}</b></span>
              {(form.retention || 0) > 0 && <span>Retention held: <b style={{ color: T.amber }}>{fmtMoney(form.retention, currency)}</b></span>}
              <span style={{ color: T.faint }}>Paid payments flow into FCF; overdue pending ones raise alerts.</span>
            </div>
          </div>
        )}

        {/* Milestones */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "18px 0 8px" }}>
          <div style={secTitle}>Milestones · planned vs actual</div>
          <button onClick={() => addItem("milestones", { label: "", planned: "", actual: "" })} style={addBtn}>+ Add milestone</button>
        </div>
        {list("milestones").length === 0 ? (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.faint, padding: "4px 0" }}>No milestones yet. Add checkpoints like design freeze, UAT, go-live — they appear as ◆ on the Gantt.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list("milestones").map((m) => {
              const late = !m.actual && m.planned && new Date(m.planned) < new Date(new Date().toDateString());
              return (
                <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr auto", gap: 6, alignItems: "center", background: late ? T.brickSoft : T.bg, borderRadius: 8, padding: "8px 10px" }}>
                  <input style={small} placeholder="Milestone (e.g., UAT sign-off)" value={m.label} onChange={(e) => setItem("milestones", m.id, "label", e.target.value)} />
                  <input type="date" style={small} title="Planned date" value={m.planned} onChange={(e) => setItem("milestones", m.id, "planned", e.target.value)} />
                  <input type="date" style={small} title="Actual date (blank = pending)" value={m.actual} onChange={(e) => setItem("milestones", m.id, "actual", e.target.value)} />
                  <button onClick={() => removeItem("milestones", m.id)} aria-label="Remove milestone" style={rmBtn}>✕</button>
                </div>
              );
            })}
          </div>
        )}

        {/* Risk register */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "18px 0 8px" }}>
          <div style={secTitle}>Risk register · probability × impact (1–5)</div>
          <button onClick={() => addItem("risks", { title: "", owner: "", probability: 3, impact: 3, mitigation: "", status: "Open" })} style={addBtn}>+ Add risk</button>
        </div>
        {list("risks").length === 0 ? (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.faint, padding: "4px 0" }}>No risks logged. Risks with score ≥ 15 that aren't closed raise portfolio alerts.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list("risks").map((r) => {
              const score = (r.probability || 0) * (r.impact || 0);
              const sc = score >= 15 ? T.brick : score >= 8 ? T.amber : T.teal;
              return (
                <div key={r.id} style={{ background: T.bg, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 0.6fr 0.6fr 0.9fr auto", gap: 6, alignItems: "center" }}>
                    <input style={small} placeholder="Risk description" value={r.title} onChange={(e) => setItem("risks", r.id, "title", e.target.value)} />
                    <input style={small} placeholder="Owner" value={r.owner} onChange={(e) => setItem("risks", r.id, "owner", e.target.value)} />
                    <input type="number" min="1" max="5" style={small} title="Probability 1–5" value={r.probability} onChange={(e) => setItem("risks", r.id, "probability", Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
                    <input type="number" min="1" max="5" style={small} title="Impact 1–5" value={r.impact} onChange={(e) => setItem("risks", r.id, "impact", Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
                    <select style={small} value={r.status} onChange={(e) => setItem("risks", r.id, "status", e.target.value)}>
                      {RISK_STATUS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <button onClick={() => removeItem("risks", r.id)} aria-label="Remove risk" style={rmBtn}>✕</button>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: sc, whiteSpace: "nowrap" }}>Score {score}/25</span>
                    <input style={{ ...small, flex: 1 }} placeholder="Mitigation plan" value={r.mitigation} onChange={(e) => setItem("risks", r.id, "mitigation", e.target.value)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Issues & change requests */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "18px 0 8px" }}>
          <div style={secTitle}>Issues & change requests</div>
          <button onClick={() => addItem("issues", { date: new Date().toISOString().slice(0, 10), title: "", type: "Issue", costImpact: 0, timeImpact: 0, status: "Open" })} style={addBtn}>+ Add entry</button>
        </div>
        {list("issues").length === 0 ? (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.faint, padding: "4px 0" }}>No issues or change requests. Log scope changes here with their cost and schedule impact.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list("issues").map((i) => (
              <div key={i.id} style={{ display: "grid", gridTemplateColumns: "0.9fr 1.7fr 1fr 0.9fr 0.7fr 0.9fr auto", gap: 6, alignItems: "center", background: T.bg, borderRadius: 8, padding: "8px 10px" }}>
                <input type="date" style={small} value={i.date} onChange={(e) => setItem("issues", i.id, "date", e.target.value)} />
                <input style={small} placeholder="Description" value={i.title} onChange={(e) => setItem("issues", i.id, "title", e.target.value)} />
                <select style={small} value={i.type} onChange={(e) => setItem("issues", i.id, "type", e.target.value)}>
                  {ISSUE_TYPE.map((s) => <option key={s}>{s}</option>)}
                </select>
                <input type="number" min="0" style={small} title={`Cost impact (${currency})`} placeholder={`Cost ${currency}`} value={i.costImpact || ""} onChange={(e) => setItem("issues", i.id, "costImpact", Number(e.target.value) || 0)} />
                <input type="number" style={small} title="Schedule impact (days)" placeholder="Days" value={i.timeImpact || ""} onChange={(e) => setItem("issues", i.id, "timeImpact", Number(e.target.value) || 0)} />
                <select style={small} value={i.status} onChange={(e) => setItem("issues", i.id, "status", e.target.value)}>
                  {ISSUE_STATUS.map((s) => <option key={s}>{s}</option>)}
                </select>
                <button onClick={() => removeItem("issues", i.id)} aria-label="Remove entry" style={rmBtn}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Status updates */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "18px 0 8px" }}>
          <div style={secTitle}>Status updates · weekly commentary</div>
          <button onClick={() => addItem("updates", { date: new Date().toISOString().slice(0, 10), by: "", note: "" })} style={addBtn}>+ Add update</button>
        </div>
        {list("updates").length === 0 ? (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.faint, padding: "4px 0" }}>No updates yet. A short weekly note ("what changed, what's blocked, what's needed") keeps leadership informed.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...list("updates")].sort((a, b) => (b.date || "") < (a.date || "") ? -1 : 1).map((u) => (
              <div key={u.id} style={{ display: "grid", gridTemplateColumns: "0.9fr 0.9fr 2.4fr auto", gap: 6, alignItems: "center", background: T.bg, borderRadius: 8, padding: "8px 10px" }}>
                <input type="date" style={small} value={u.date} onChange={(e) => setItem("updates", u.id, "date", e.target.value)} />
                <input style={small} placeholder="By" value={u.by} onChange={(e) => setItem("updates", u.id, "by", e.target.value)} />
                <input style={small} placeholder="Update note" value={u.note} onChange={(e) => setItem("updates", u.id, "note", e.target.value)} />
                <button onClick={() => removeItem("updates", u.id)} aria-label="Remove update" style={rmBtn}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 18, marginTop: 16, padding: "10px 14px", background: T.bg, borderRadius: 8, flexWrap: "wrap" }}>
          {[["Cost variance", pct(d.variance), d.variance > 0 ? T.brick : T.teal],
            ["Free cash flow", fmtMoney(d.fcf, currency), d.fcf < 0 ? T.brick : T.teal],
            ["Net margin", pct(d.margin), d.margin < 0 ? T.brick : T.teal],
            ["ROI", d.roi === null ? "—" : pct(d.roi), d.roi !== null && d.roi < 0 ? T.brick : T.teal],
            ["Payback", d.payback === null ? "—" : `${Math.round(d.payback * 10) / 10} mo`, T.ink],
            ["Committed + actual", fmtMoney(d.totalCommitted, currency), form.budget > 0 && d.totalCommitted > form.budget ? T.brick : T.slate],
            ["Slippage vs baseline", d.slippage === null ? "—" : (d.slippage > 0 ? `+${d.slippage} d` : `${d.slippage} d`), d.slippage !== null && d.slippage > 0 ? T.brick : T.teal]].map(([l, v, c]) => (
            <div key={l}>
              <div style={{ fontFamily: T.body, fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: 0.6 }}>{l}</div>
              <div style={{ fontFamily: T.display, fontSize: 15, fontWeight: 700, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {!isNew ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { if (confirmDel) { onDelete(form.id); } else { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 4000); } }}
                style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: confirmDel ? "#FFF" : T.brick, background: confirmDel ? T.brick : T.brickSoft, border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>
                {confirmDel ? "Click again to confirm delete" : "Delete project"}
              </button>
              <button onClick={() => onDuplicate(form.id)}
                style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>
                ⧉ Duplicate
              </button>
            </div>
          ) : <span />}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {errMsg && <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.brick }}>{errMsg}</span>}
            <button onClick={onClose} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.slate, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>Cancel</button>
            <button onClick={() => { if (!form.name.trim()) { setErrMsg("Give the project a name."); return; } onSave({ ...form, id: form.id || "p" + Date.now() }); }}
              style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer" }}>
              {isNew ? "Add project" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TASK HELPERS + MODAL
   ============================================================ */
const isOverdue = (t) => t.dueDate && t.status !== "Done" && new Date(t.dueDate) < new Date(new Date().toDateString());
const taskDuration = (t) => (t.startDate && t.dueDate && dayDiff(t.startDate, t.dueDate) >= 0 ? dayDiff(t.startDate, t.dueDate) : null);

function TaskBadge({ status }) {
  const s = TASK_STATUS[status] || TASK_STATUS["To Do"];
  return (
    <span style={{ background: s.soft, color: s.color, fontFamily: T.body, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function TaskModal({ task, departments, projects, currency, resourceNames, allTasks, rates, onSave, onDelete, onDuplicate, onClose }) {
  const [form, setForm] = useState(task ? { ...task } : { ...EMPTY_TASK, department: departments[0] || "" });
  const [newPerson, setNewPerson] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const isNew = !task;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dur = taskDuration(form);
  const names = resourceNames || [];
  const knownAssignee = !form.assignee || names.includes(form.assignee);
  const depOptions = (allTasks || []).filter((x) => x.id !== form.id);
  const assigneeRate = Number((rates || {})[form.assignee]) || 0;
  const suggestedCost = assigneeRate > 0 && (form.estHours || 0) > 0 ? assigneeRate * form.estHours : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,28,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", padding: 22, boxShadow: "0 24px 60px rgba(16,28,46,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontFamily: T.display, fontSize: 19, fontWeight: 700, color: T.ink, margin: 0 }}>{isNew ? "Add task" : "Edit task"}</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 20, color: T.faint, cursor: "pointer" }} aria-label="Close">✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Field label="Task title" span><input style={inputStyle} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g., Finalize vendor contract" /></Field>
          <Field label="Department">
            <select style={inputStyle} value={form.department} onChange={(e) => set("department", e.target.value)}>
              {[...new Set([...departments, form.department])].filter(Boolean).map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Linked project (optional)">
            <select style={inputStyle} value={form.projectId} onChange={(e) => set("projectId", e.target.value)}>
              <option value="">— None —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Assignee (resource)">
            {!newPerson && knownAssignee ? (
              <select style={inputStyle} value={form.assignee || ""} onChange={(e) => {
                if (e.target.value === "__new__") { setNewPerson(true); set("assignee", ""); }
                else set("assignee", e.target.value);
              }}>
                <option value="">— Unassigned —</option>
                {names.map((n) => <option key={n} value={n}>{n}</option>)}
                <option value="__new__">+ New person…</option>
              </select>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <input style={inputStyle} autoFocus={newPerson} value={form.assignee} onChange={(e) => set("assignee", e.target.value)} placeholder="New person's name" />
                <button onClick={() => { setNewPerson(false); if (!names.includes(form.assignee)) set("assignee", ""); }}
                  title="Pick from existing resources" style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.slate, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "0 10px", cursor: "pointer", whiteSpace: "nowrap" }}>List</button>
              </div>
            )}
          </Field>
          <Field label="Start date"><input type="date" style={inputStyle} value={form.startDate || ""} onChange={(e) => set("startDate", e.target.value)} /></Field>
          <Field label="Due date"><input type="date" style={inputStyle} value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></Field>
          <Field label={`Task cost (${currency})`}><input type="number" min="0" style={inputStyle} value={form.cost || 0} onChange={(e) => set("cost", e.target.value === "" ? 0 : Number(e.target.value))} /></Field>
          <Field label="Estimated hours"><input type="number" min="0" style={inputStyle} value={form.estHours || 0} onChange={(e) => set("estHours", e.target.value === "" ? 0 : Number(e.target.value))} /></Field>
          <Field label="Depends on (predecessor)" span>
            <select style={inputStyle} value={form.dependsOn || ""} onChange={(e) => set("dependsOn", e.target.value)}>
              <option value="">— No dependency —</option>
              {depOptions.map((x) => <option key={x.id} value={x.id}>{x.title}{x.status === "Done" ? " ✓" : ""}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select style={inputStyle} value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              {Object.keys(PRIORITY).map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select style={inputStyle} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {Object.keys(TASK_STATUS).map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 16, padding: "10px 14px", background: T.bg, borderRadius: 8, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: T.body, fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: 0.6 }}>Duration</div>
            <div style={{ fontFamily: T.display, fontSize: 15, fontWeight: 700, color: T.ink }}>{dur !== null ? `${dur} day${dur === 1 ? "" : "s"}` : "— (needs start + due date)"}</div>
          </div>
          {dur !== null && dur > 0 && (form.cost || 0) > 0 && (
            <div>
              <div style={{ fontFamily: T.body, fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: 0.6 }}>Cost / day</div>
              <div style={{ fontFamily: T.display, fontSize: 15, fontWeight: 700, color: T.ink }}>{fmtMoney((form.cost || 0) / dur, currency)}</div>
            </div>
          )}
          {suggestedCost !== null && (
            <div>
              <div style={{ fontFamily: T.body, fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: 0.6 }}>Suggested cost (rate × est. hours)</div>
              <div style={{ fontFamily: T.display, fontSize: 15, fontWeight: 700, color: T.ink, display: "flex", alignItems: "center", gap: 8 }}>
                {fmtMoney(suggestedCost, currency)}
                {suggestedCost !== (form.cost || 0) && (
                  <button onClick={() => set("cost", suggestedCost)}
                    style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.blue, background: T.blueSoft, border: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                    Apply
                  </button>
                )}
              </div>
              <div style={{ fontFamily: T.body, fontSize: 10, color: T.faint }}>{form.estHours} h × {fmtMoney(assigneeRate, currency)}/h ({form.assignee})</div>
            </div>
          )}
          {form.dependsOn && (() => {
            const dep = depOptions.find((x) => x.id === form.dependsOn);
            const blocked = dep && dep.status !== "Done";
            return (
              <div>
                <div style={{ fontFamily: T.body, fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: 0.6 }}>Dependency</div>
                <div style={{ fontFamily: T.display, fontSize: 15, fontWeight: 700, color: blocked ? T.amber : T.teal }}>{dep ? (blocked ? "Waiting — predecessor not done" : "Predecessor done ✓") : "—"}</div>
              </div>
            );
          })()}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {!isNew ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { if (confirmDel) { onDelete(form.id); } else { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 4000); } }}
                style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: confirmDel ? "#FFF" : T.brick, background: confirmDel ? T.brick : T.brickSoft, border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>
                {confirmDel ? "Click again to confirm delete" : "Delete task"}
              </button>
              <button onClick={() => onDuplicate(form.id)}
                style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>
                ⧉ Duplicate
              </button>
            </div>
          ) : <span />}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {errMsg && <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.brick }}>{errMsg}</span>}
            <button onClick={onClose} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.slate, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>Cancel</button>
            <button onClick={() => { if (!form.title.trim()) { setErrMsg("Give the task a title."); return; } onSave({ ...form, id: form.id || "t" + Date.now() }); }}
              style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer" }}>
              {isNew ? "Add task" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   BOM HELPERS + MODAL
   ============================================================ */
const bomDeliveryOverdue = (b) => b.expectedDelivery && b.deliveryStatus !== "Delivered" && new Date(b.expectedDelivery) < new Date(new Date().toDateString());
const bomCostVariance = (b) => (b.estCost > 0 && b.actualCost > 0 ? ((b.actualCost - b.estCost) / b.estCost) * 100 : null);
/* Material receipt: actual number of days from release to delivery.
   If not yet delivered, shows days elapsed since release. */
const bomReceiptDays = (b) => {
  if (!b.releaseDate) return null;
  if (b.actualDelivery) {
    const d = dayDiff(b.releaseDate, b.actualDelivery);
    return d >= 0 ? { days: d, done: true } : null;
  }
  const d = dayDiff(b.releaseDate, new Date().toISOString().slice(0, 10));
  return d >= 0 ? { days: d, done: false } : null;
};
const bomDelayDays = (b) => (b.expectedDelivery && b.actualDelivery ? dayDiff(b.expectedDelivery, b.actualDelivery) : null);

function Pill({ label, map }) {
  const s = map[label] || Object.values(map)[0];
  return (
    <span style={{ background: s.soft, color: s.color, fontFamily: T.body, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function BomModal({ bom, projects, currency, onSave, onDelete, onDuplicate, onClose }) {
  const [form, setForm] = useState(bom ? { ...bom } : { ...EMPTY_BOM });
  const [confirmDel, setConfirmDel] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const isNew = !bom;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k) => (e) => set(k, e.target.value === "" ? 0 : Number(e.target.value));
  const cv = bomCostVariance(form);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,28,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", padding: 22, boxShadow: "0 24px 60px rgba(16,28,46,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontFamily: T.display, fontSize: 19, fontWeight: 700, color: T.ink, margin: 0 }}>{isNew ? "Add BOM release" : "Edit BOM release"}</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 20, color: T.faint, cursor: "pointer" }} aria-label="Close">✕</button>
        </div>

        <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Release details</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Field label="BOM number"><input style={inputStyle} value={form.bomNo} onChange={(e) => set("bomNo", e.target.value)} placeholder="BOM-2026-001" /></Field>
          <Field label="Revision"><input style={inputStyle} value={form.revision} onChange={(e) => set("revision", e.target.value)} placeholder="A" /></Field>
          <Field label="Title / assembly" span><input style={inputStyle} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g., Conveyor drive assembly" /></Field>
          <Field label="Linked project">
            <select style={inputStyle} value={form.projectId} onChange={(e) => set("projectId", e.target.value)}>
              <option value="">— None —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Released by"><input style={inputStyle} value={form.releasedBy} onChange={(e) => set("releasedBy", e.target.value)} placeholder="Engineer name" /></Field>
          <Field label="Release date"><input type="date" style={inputStyle} value={form.releaseDate} onChange={(e) => set("releaseDate", e.target.value)} /></Field>
          <Field label="Release status">
            <select style={inputStyle} value={form.releaseStatus} onChange={(e) => set("releaseStatus", e.target.value)}>
              {Object.keys(BOM_STATUS).map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Line items"><input type="number" min="0" style={inputStyle} value={form.items} onChange={num("items")} /></Field>
          <Field label="Vendor / supplier"><input style={inputStyle} value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Supplier name" /></Field>
        </div>

        <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.8, margin: "16px 0 8px" }}>Delivery tracking</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Field label="Delivery status">
            <select style={inputStyle} value={form.deliveryStatus} onChange={(e) => set("deliveryStatus", e.target.value)}>
              {Object.keys(DELIVERY_STATUS).map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Expected delivery"><input type="date" style={inputStyle} value={form.expectedDelivery} onChange={(e) => set("expectedDelivery", e.target.value)} /></Field>
          <Field label="Actual delivery"><input type="date" style={inputStyle} value={form.actualDelivery} onChange={(e) => set("actualDelivery", e.target.value)} /></Field>
        </div>

        <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.8, margin: "16px 0 8px" }}>Cost tracking</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Field label={`Estimated cost (${currency})`}><input type="number" min="0" style={inputStyle} value={form.estCost} onChange={num("estCost")} /></Field>
          <Field label={`Actual cost (${currency})`}><input type="number" min="0" style={inputStyle} value={form.actualCost} onChange={num("actualCost")} /></Field>
        </div>

        <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.8, margin: "16px 0 8px" }}>Quality / incoming inspection</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Field label="Inspection status">
            <select style={inputStyle} value={form.inspectionStatus || "Not Inspected"} onChange={(e) => set("inspectionStatus", e.target.value)}>
              {Object.keys(INSPECTION_STATUS).map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Rejection %"><input type="number" min="0" max="100" style={inputStyle} value={form.rejectionPct || 0} onChange={num("rejectionPct")} /></Field>
          <Field label={`Rework cost (${currency})`}><input type="number" min="0" style={inputStyle} value={form.reworkCost || 0} onChange={num("reworkCost")} /></Field>
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 16, padding: "10px 14px", background: T.bg, borderRadius: 8, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: T.body, fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: 0.6 }}>Cost variance</div>
            <div style={{ fontFamily: T.display, fontSize: 15, fontWeight: 700, color: cv === null ? T.slate : cv > 0 ? T.brick : T.teal }}>
              {cv === null ? "— (needs est. + actual)" : (cv > 0 ? "+" : "") + pct(cv)}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: T.body, fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: 0.6 }}>Delivery</div>
            <div style={{ fontFamily: T.display, fontSize: 15, fontWeight: 700, color: bomDeliveryOverdue(form) ? T.brick : T.teal }}>
              {bomDeliveryOverdue(form) ? "Overdue" : form.deliveryStatus}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {!isNew ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { if (confirmDel) { onDelete(form.id); } else { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 4000); } }}
                style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: confirmDel ? "#FFF" : T.brick, background: confirmDel ? T.brick : T.brickSoft, border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>
                {confirmDel ? "Click again to confirm delete" : "Delete BOM"}
              </button>
              <button onClick={() => onDuplicate(form.id)}
                style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>
                ⧉ Duplicate
              </button>
            </div>
          ) : <span />}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {errMsg && <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.brick }}>{errMsg}</span>}
            <button onClick={onClose} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.slate, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>Cancel</button>
            <button onClick={() => { if (!form.bomNo.trim() && !form.title.trim()) { setErrMsg("Give the BOM a number or title."); return; } onSave({ ...form, id: form.id || "b" + Date.now() }); }}
              style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer" }}>
              {isNew ? "Add BOM" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MAIN APP
   ============================================================ */
export default function PortfolioTracker() {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [departments, setDepartments] = useState(DEFAULT_DEPARTMENTS);
  const [verticals, setVerticals] = useState(DEFAULT_VERTICALS);
  const [newVertical, setNewVertical] = useState("");
  const [filterVertical, setFilterVertical] = useState("All");
  const [currency, setCurrency] = useState("₹");
  const [marginTarget, setMarginTarget] = useState(15);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [lastSync, setLastSync] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [seedPreview, setSeedPreview] = useState(false);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState(null); // null | "new" | project object
  const [taskModal, setTaskModal] = useState(null); // null | "new" | task object
  const [boms, setBoms] = useState([]);
  const [bomModal, setBomModal] = useState(null); // null | "new" | bom object
  const [bomProject, setBomProject] = useState("All");
  const [bomRelFilter, setBomRelFilter] = useState("All");
  const [bomDelFilter, setBomDelFilter] = useState("All");
  const [bomSearch, setBomSearch] = useState("");
  const [uploadKind, setUploadKind] = useState("tasks"); // "tasks" | "boms"
  const [ganttView, setGanttView] = useState("projects"); // "projects" | "tasks"
  const [tlDept, setTlDept] = useState("All");
  const [tlVertical, setTlVertical] = useState("All");
  const [tlStatus, setTlStatus] = useState("All");
  const [tlView, setTlView] = useState("projects"); // "projects" | "tasks" for the timeline tab
  const [resourceSearch, setResourceSearch] = useState("");
  const [expandedResource, setExpandedResource] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [activity, setActivity] = useState([]);
  const [capacities, setCapacities] = useState({}); // { name: hoursPerWeek }
  const [rates, setRates] = useState({}); // { name: hourly cost rate }
  const [people, setPeople] = useState([]); // manually added resource names
  const [resourceDepts, setResourceDepts] = useState({}); // { name: home department }
  const [newResource, setNewResource] = useState("");
  const [newResourceDept, setNewResourceDept] = useState("");
  const [resourceDeptFilter, setResourceDeptFilter] = useState("All");
  const [resetArmed, setResetArmed] = useState(false);
  const [confirmRemoveResource, setConfirmRemoveResource] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [exportKind, setExportKind] = useState("projects");
  const [exportError, setExportError] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const [restorePaste, setRestorePaste] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  const [backupText, setBackupText] = useState("");
  const [projSubTab, setProjSubTab] = useState("table"); // table | board | financials
  const [showTemplate, setShowTemplate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [filterDept, setFilterDept] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [taskDept, setTaskDept] = useState("All");
  const [taskProject, setTaskProject] = useState("All");
  const [taskStatusFilter, setTaskStatusFilter] = useState("All");
  const [taskSearch, setTaskSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [newDept, setNewDept] = useState("");
  const [renaming, setRenaming] = useState(null); // { kind: "dept"|"vert", name } being renamed
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelDept, setConfirmDelDept] = useState(null);
  const [confirmDelVert, setConfirmDelVert] = useState(null);

  /* ---------- load shared data ---------- */
  useEffect(() => {
    (async () => {
      /* v3.2 LOAD FIX. The old loader had two bugs that reverted edits:
         (1) Any transient storage error was treated as "no saved data",
             so the app silently re-showed SAMPLE data — and the next
             save overwrote your real data with samples + defaults.
         (2) If you deleted all default departments/verticals, an empty
             list was "restored" to the defaults on every reload.
         Now: retry the read 3 times; respect empty lists; only seed
         samples after confirming (via key listing) that no saved data
         exists — never on a mere read error. */
      let data = null;
      let readOk = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await window.storage.get(STORAGE_KEY, true);
          if (res && res.value) data = JSON.parse(res.value);
          readOk = true;
          break;
        } catch (e) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (data) {
        setProjects(data.projects || []);
        setTasks(data.tasks || []);
        setBoms(data.boms || []);
        setDepartments(data.departments !== undefined ? data.departments : DEFAULT_DEPARTMENTS);
        setVerticals(data.verticals !== undefined ? data.verticals : DEFAULT_VERTICALS);
        setCurrency(data.currency || "₹");
        setMarginTarget(data.marginTarget ?? 15);
        setActivity(data.activity || []);
        setCapacities(data.capacities || {});
        setRates(data.rates || {});
        setPeople(data.people || []);
        setResourceDepts(data.resourceDepts || {});
        setLastSync(new Date());
      } else {
        /* v3.4 ROOT-CAUSE FIX — samples are NEVER auto-written to
           storage. Earlier versions wrote SAMPLE data + DEFAULT lists
           to the shared key whenever storage looked empty (including
           after a rebuild or a flaky read). That write is exactly what
           erased your real departments and verticals. Now: if reads
           kept failing we do NOT assume a first run — we show an empty
           workspace and let you retry with the Sync button, so nothing
           is ever overwritten. Only a confirmed-empty key shows sample
           data, and even then purely as an in-memory preview that is
           written to storage ONLY when you press "Start with sample
           data" or make your first edit. */
        let keyExists = false;
        let listOk = false;
        try {
          const listing = await window.storage.list("portfolio-tracker-data-v2", true);
          listOk = true;
          keyExists = !!(listing && listing.keys && listing.keys.includes(STORAGE_KEY));
        } catch (e) { /* listing failed */ }

        if (keyExists || (!readOk && !listOk)) {
          // Data exists but couldn't be read, OR we can't tell — do NOT
          // seed. Show empty + a retry banner. Never overwrite.
          setLoadError(true);
          setProjects([]); setTasks([]); setBoms([]);
          setDepartments(DEFAULT_DEPARTMENTS); setVerticals(DEFAULT_VERTICALS);
        } else {
          // Confirmed genuine first run: preview samples in memory only.
          setSeedPreview(true);
          setProjects(SAMPLE_PROJECTS);
          setTasks(SAMPLE_TASKS);
          setBoms(SAMPLE_BOMS);
        }
      }
      setLoading(false);
    })();
  }, []);

  /* ---------- persist (single shared key) ---------- */
  /* Every shared field with its current value and setter — used by
     persist() and refreshFromStorage() below. */
  const FIELD_STATE = {
    projects: [projects, setProjects],
    tasks: [tasks, setTasks],
    boms: [boms, setBoms],
    departments: [departments, setDepartments],
    verticals: [verticals, setVerticals],
    currency: [currency, setCurrency],
    marginTarget: [marginTarget, setMarginTarget],
    activity: [activity, setActivity],
    capacities: [capacities, setCapacities],
    rates: [rates, setRates],
    people: [people, setPeople],
    resourceDepts: [resourceDepts, setResourceDepts],
  };

  async function persist(next) {
    setSaveState("saving");
    try {
      /* v3.2 CONCURRENCY FIX — READ-MERGE-WRITE.
         Previously every save wrote this session's ENTIRE in-memory
         state over the shared key. If a teammate (or your own second
         tab / phone) had saved anything in the meantime, their changes
         — e.g. renamed departments and verticals — were silently
         REVERTED by this session's stale copy. That is the bug that
         made edits "disappear".
         Now: re-read the shared data first; for every field this
         action does NOT change, keep the freshest stored value; only
         the fields explicitly passed in `next` are overwritten. */
      let base = {};
      try {
        const res = await window.storage.get(STORAGE_KEY, true);
        if (res && res.value) base = JSON.parse(res.value) || {};
      } catch (e) { /* key may not exist yet (first ever save) */ }
      const payload = {};
      Object.entries(FIELD_STATE).forEach(([k, [val]]) => {
        payload[k] = k in next ? next[k] : (base[k] !== undefined ? base[k] : val);
      });
      // Activity log: merge (not overwrite) so no teammate entries are lost
      if ("activity" in next && Array.isArray(base.activity)) {
        const ids = new Set((next.activity || []).map((a) => a.id));
        payload.activity = [...(next.activity || []), ...base.activity.filter((a) => !ids.has(a.id))]
          .sort((a, b) => ((b.ts || "") < (a.ts || "") ? -1 : 1)).slice(0, 100);
      }
      const ok = await window.storage.set(STORAGE_KEY, JSON.stringify(payload), true);
      // Pull teammates' fresher values into this session for every
      // field we did not touch, so the screen shows the latest truth.
      Object.entries(FIELD_STATE).forEach(([k, [val, setter]]) => {
        if (!(k in next) && base[k] !== undefined && JSON.stringify(base[k]) !== JSON.stringify(val)) setter(base[k]);
      });
      setLastSync(new Date());
      setSaveState(ok ? "saved" : "error");
    } catch (e) {
      setSaveState("error");
    }
    setTimeout(() => setSaveState("idle"), 1800);
  }

  /* Pull the latest shared data into this session (no writing).
     Runs on tab focus, every 45s, and via the header Sync button. */
  async function refreshFromStorage(silent) {
    try {
      const res = await window.storage.get(STORAGE_KEY, true);
      if (res && res.value) {
        const d = JSON.parse(res.value) || {};
        Object.entries(FIELD_STATE).forEach(([k, [val, setter]]) => {
          if (d[k] !== undefined && JSON.stringify(d[k]) !== JSON.stringify(val)) setter(d[k]);
        });
        // A real read succeeded — we are no longer in an error/preview state.
        setLoadError(false); setSeedPreview(false);
        setLastSync(new Date());
        if (!silent) { setSaveState("saved"); setTimeout(() => setSaveState("idle"), 1200); }
      } else if (!silent) {
        // No data at the key yet — surface it rather than seeding samples.
        setSaveState("idle");
      }
    } catch (e) {
      if (!silent) { setSaveState("error"); setTimeout(() => setSaveState("idle"), 1800); }
    }
  }
  const refreshRef = useRef(null);
  refreshRef.current = refreshFromStorage;
  // True whenever the user is mid-edit — silent auto-refresh must NOT
  // pull storage over an open form, or in-progress edits vanish.
  const editingRef = useRef(false);
  editingRef.current = !!(modal || taskModal || bomModal || showUpload || showExport || showSettings || renaming || seedPreview);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && !editingRef.current && refreshRef.current) refreshRef.current(true); };
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(() => { if (!editingRef.current && refreshRef.current) refreshRef.current(true); }, 45000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(iv); };
  }, []);

  /* ---------- activity log ---------- */
  const logAct = (action) => {
    const entry = { id: "a" + Date.now() + Math.floor(Math.random() * 1000), ts: new Date().toISOString().replace("T", " ").slice(0, 16), action };
    // Functional update avoids stale-closure loss when two actions fire
    // in the same tick. persist() dedupes/merges activity by id, so
    // returning just [entry] is safe — storage keeps prior entries.
    setActivity((prev) => [entry, ...prev].slice(0, 100));
    return [entry];
  };

  const saveProject = (p) => {
    const exists = projects.some((x) => x.id === p.id);
    const next = exists ? projects.map((x) => (x.id === p.id ? p : x)) : [...projects, p];
    setProjects(next); setModal(null); persist({ projects: next, activity: logAct(`Project "${p.name}" ${exists ? "updated" : "added"}`) });
  };
  const deleteProject = (id) => {
    const gone = projects.find((x) => x.id === id);
    const next = projects.filter((x) => x.id !== id);
    setProjects(next); setModal(null); persist({ projects: next, activity: logAct(`Project "${gone ? gone.name : id}" deleted`) });
  };
  const duplicateProject = (id) => {
    const src = projects.find((x) => x.id === id);
    if (!src) return;
    const copy = { ...JSON.parse(JSON.stringify(src)), id: "p" + Date.now(), name: `${src.name} (copy)` };
    const next = [...projects, copy];
    setProjects(next); setModal(null); persist({ projects: next, activity: logAct(`Project "${src.name}" duplicated`) });
  };
  const resetAll = async () => {
    setProjects(SAMPLE_PROJECTS); setDepartments(DEFAULT_DEPARTMENTS); setTasks(SAMPLE_TASKS); setBoms(SAMPLE_BOMS); setVerticals(DEFAULT_VERTICALS); setActivity([]); setCapacities({}); setRates({}); setPeople([]); setResourceDepts({});
    persist({ projects: SAMPLE_PROJECTS, departments: DEFAULT_DEPARTMENTS, tasks: SAMPLE_TASKS, boms: SAMPLE_BOMS, verticals: DEFAULT_VERTICALS, activity: [], capacities: {}, rates: {}, people: [], resourceDepts: {} });
  };

  /* ---------- rename with cascade ----------
     Renaming a department/vertical in Settings updates the master list
     AND every project, task, and resource link using the old name, so
     edited names stick everywhere instead of the old name resurfacing. */
  const renameDepartment = (oldName, newNameRaw) => {
    const newName = (newNameRaw || "").trim();
    if (!newName || newName === oldName) return;
    const nextDepts = departments.map((d) => (d === oldName ? newName : d)).filter((d, i, a) => a.indexOf(d) === i);
    const nextProjects = projects.map((p) => (p.department === oldName ? { ...p, department: newName } : p));
    const nextTasks = tasks.map((t) => (t.department === oldName ? { ...t, department: newName } : t));
    const nextRd = {};
    Object.entries(resourceDepts).forEach(([k, v]) => { nextRd[k] = v === oldName ? newName : v; });
    setDepartments(nextDepts); setProjects(nextProjects); setTasks(nextTasks); setResourceDepts(nextRd);
    persist({ departments: nextDepts, projects: nextProjects, tasks: nextTasks, resourceDepts: nextRd, activity: logAct(`Department "${oldName}" renamed to "${newName}" (applied to all records)`) });
  };
  const renameVertical = (oldName, newNameRaw) => {
    const newName = (newNameRaw || "").trim();
    if (!newName || newName === oldName) return;
    const nextVerts = verticals.map((v) => (v === oldName ? newName : v)).filter((v, i, a) => a.indexOf(v) === i);
    const nextProjects = projects.map((p) => (p.vertical === oldName ? { ...p, vertical: newName } : p));
    setVerticals(nextVerts); setProjects(nextProjects);
    persist({ verticals: nextVerts, projects: nextProjects, activity: logAct(`Vertical "${oldName}" renamed to "${newName}" (applied to all records)`) });
  };

  /* ---------- BOM CRUD ---------- */
  const saveBom = (b) => {
    const exists = boms.some((x) => x.id === b.id);
    const next = exists ? boms.map((x) => (x.id === b.id ? b : x)) : [...boms, b];
    setBoms(next); setBomModal(null); persist({ boms: next, activity: logAct(`BOM "${b.bomNo || b.title}" ${exists ? "updated" : "added"}`) });
  };
  const deleteBom = (id) => {
    const gone = boms.find((x) => x.id === id);
    const next = boms.filter((x) => x.id !== id);
    setBoms(next); setBomModal(null); persist({ boms: next, activity: logAct(`BOM "${gone ? gone.bomNo || gone.title : id}" deleted`) });
  };
  const duplicateBom = (id) => {
    const src = boms.find((x) => x.id === id);
    if (!src) return;
    const copy = { ...JSON.parse(JSON.stringify(src)), id: "b" + Date.now(), bomNo: src.bomNo ? `${src.bomNo}-copy` : "", title: src.title ? `${src.title} (copy)` : "" };
    const next = [...boms, copy];
    setBoms(next); setBomModal(null); persist({ boms: next, activity: logAct(`BOM "${src.bomNo || src.title}" duplicated`) });
  };

  /* ---------- task CRUD ---------- */
  const saveTask = (t) => {
    const exists = tasks.some((x) => x.id === t.id);
    const next = exists ? tasks.map((x) => (x.id === t.id ? t : x)) : [...tasks, t];
    setTasks(next); setTaskModal(null); persist({ tasks: next, activity: logAct(`Task "${t.title}" ${exists ? "updated" : "added"}`) });
  };
  const deleteTask = (id) => {
    const gone = tasks.find((x) => x.id === id);
    const next = tasks.filter((x) => x.id !== id);
    setTasks(next); setTaskModal(null); persist({ tasks: next, activity: logAct(`Task "${gone ? gone.title : id}" deleted`) });
  };
  const duplicateTask = (id) => {
    const src = tasks.find((x) => x.id === id);
    if (!src) return;
    const copy = { ...JSON.parse(JSON.stringify(src)), id: "t" + Date.now(), title: `${src.title} (copy)`, status: "To Do", dependsOn: "" };
    const next = [...tasks, copy];
    setTasks(next); setTaskModal(null); persist({ tasks: next, activity: logAct(`Task "${src.title}" duplicated`) });
  };
  const toggleTaskDone = (t) => {
    const next = tasks.map((x) => (x.id === t.id ? { ...x, status: x.status === "Done" ? "To Do" : "Done" } : x));
    setTasks(next); persist({ tasks: next, activity: logAct(`Task "${t.title}" marked ${t.status === "Done" ? "not done" : "done"}`) });
  };

  /* ---------- CSV upload ----------
     Note: programmatic file downloads can be blocked inside the app
     sandbox, so the template is shown for copy instead, and CSV can
     be imported either from a file or pasted text. */
  function copyTemplate() {
    const text = uploadKind === "boms" ? BOM_CSV_TEMPLATE : uploadKind === "projects" ? PROJECT_CSV_TEMPLATE : CSV_TEMPLATE;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => setShowTemplate(true));
    } else {
      setShowTemplate(true);
    }
  }

  function downloadExcelTemplate() {
    try {
      const tmpl = uploadKind === "boms" ? BOM_CSV_TEMPLATE : uploadKind === "projects" ? PROJECT_CSV_TEMPLATE : CSV_TEMPLATE;
      const parsed = Papa.parse(tmpl, { header: true, skipEmptyLines: true });
      const ws = XLSX.utils.json_to_sheet(parsed.data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Template");
      XLSX.writeFile(wb, `${uploadKind}-upload-template.xlsx`);
    } catch (e) {
      setUploadResult({ count: 0, skipped: ["Excel download was blocked on this device — use Copy CSV template instead and paste into Excel."] });
    }
  }

  function handleCsvFile(input) {
    // Accepts a File object (CSV or Excel) or a raw CSV string (pasted text)
    if (!input) return;
    if (typeof input === "string" && !input.trim()) {
      setUploadResult({ count: 0, skipped: ["Paste your CSV rows first, then press Import."] });
      return;
    }
    // Excel file? Convert the first sheet to CSV, then route as usual.
    if (typeof input !== "string" && /\.(xlsx|xls)$/i.test(input.name || "")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const csv = XLSX.utils.sheet_to_csv(ws);
          if (!csv.trim()) { setUploadResult({ count: 0, skipped: ["The first sheet of this Excel file is empty."] }); return; }
          routeCsvInput(csv);
        } catch (err) {
          setUploadResult({ count: 0, skipped: ["Could not read this Excel file. Save it as .xlsx or CSV and try again."] });
        }
      };
      reader.onerror = () => setUploadResult({ count: 0, skipped: ["Could not read this file."] });
      reader.readAsArrayBuffer(input);
      return;
    }
    routeCsvInput(input);
  }

  function routeCsvInput(input) {
    if (uploadKind === "boms") { handleBomCsv(input); return; }
    if (uploadKind === "projects") { handleProjectCsv(input); return; }
    Papa.parse(input, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, ""),
      complete: (results) => {
        const imported = [];
        const skipped = [];
        const newDepts = new Set(departments);
        results.data.forEach((row, i) => {
          const title = (row.title || row.task || "").trim();
          if (!title) { skipped.push(`Row ${i + 2}: missing title`); return; }
          const dept = (row.department || row.dept || "").trim() || departments[0] || "General";
          newDepts.add(dept);
          const projName = (row.project || "").trim().toLowerCase();
          const proj = projName ? projects.find((p) => p.name.toLowerCase() === projName) : null;
          if (projName && !proj) skipped.push(`Row ${i + 2}: project "${row.project}" not found — task imported without link`);
          let priority = (row.priority || "Medium").trim();
          priority = Object.keys(PRIORITY).find((p) => p.toLowerCase() === priority.toLowerCase()) || "Medium";
          let status = (row.status || "To Do").trim();
          status = Object.keys(TASK_STATUS).find((s) => s.toLowerCase() === status.toLowerCase()) || "To Do";
          let dueDate = (row.duedate || row.due || "").trim();
          if (dueDate && isNaN(new Date(dueDate).getTime())) { skipped.push(`Row ${i + 2}: invalid date "${dueDate}" — imported without due date`); dueDate = ""; }
          let startDate = (row.startdate || row.start || "").trim();
          if (startDate && isNaN(new Date(startDate).getTime())) { skipped.push(`Row ${i + 2}: invalid start date "${startDate}" — imported without it`); startDate = ""; }
          imported.push({
            id: "t" + Date.now() + "-" + i,
            title, department: dept, projectId: proj ? proj.id : "",
            assignee: (row.assignee || row.owner || "").trim(),
            startDate, dueDate, priority, status,
            cost: Number(row.cost || row.taskcost || 0) || 0,
            estHours: Number(row.esthours || row.hours || 0) || 0,
            dependsOn: "",
          });
        });
        if (imported.length) {
          const nextTasks = [...tasks, ...imported];
          const nextDepts = Array.from(newDepts);
          setTasks(nextTasks); setDepartments(nextDepts);
          persist({ tasks: nextTasks, departments: nextDepts, activity: logAct(`${imported.length} task${imported.length === 1 ? "" : "s"} imported via CSV`) });
        }
        setUploadResult({ count: imported.length, skipped });
      },
      error: () => setUploadResult({ count: 0, skipped: ["Could not read this file. Save it as CSV and try again."] }),
    });
  }

  function handleBomCsv(input) {
    Papa.parse(input, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, ""),
      complete: (results) => {
        const imported = [];
        const skipped = [];
        const cleanDate = (v, row, label) => {
          const d = (v || "").trim();
          if (d && isNaN(new Date(d).getTime())) { skipped.push(`Row ${row}: invalid ${label} "${d}" — imported without it`); return ""; }
          return d;
        };
        results.data.forEach((row, i) => {
          const bomNo = (row.bomno || row.bomnumber || row.bom || "").trim();
          const title = (row.title || row.assembly || row.description || "").trim();
          if (!bomNo && !title) { skipped.push(`Row ${i + 2}: missing BOM number and title`); return; }
          const projName = (row.project || "").trim().toLowerCase();
          const proj = projName ? projects.find((p) => p.name.toLowerCase() === projName) : null;
          if (projName && !proj) skipped.push(`Row ${i + 2}: project "${row.project}" not found — BOM imported without link`);
          let releaseStatus = (row.releasestatus || row.status || "Draft").trim();
          releaseStatus = Object.keys(BOM_STATUS).find((s) => s.toLowerCase() === releaseStatus.toLowerCase()) || "Draft";
          let deliveryStatus = (row.deliverystatus || "Pending").trim();
          deliveryStatus = Object.keys(DELIVERY_STATUS).find((s) => s.toLowerCase() === deliveryStatus.toLowerCase()) || "Pending";
          let inspectionStatus = (row.inspectionstatus || row.inspection || "Not Inspected").trim();
          inspectionStatus = Object.keys(INSPECTION_STATUS).find((s) => s.toLowerCase() === inspectionStatus.toLowerCase()) || "Not Inspected";
          imported.push({
            id: "b" + Date.now() + "-" + i,
            bomNo, title, projectId: proj ? proj.id : "",
            revision: (row.revision || row.rev || "A").trim(),
            releasedBy: (row.releasedby || "").trim(),
            releaseDate: cleanDate(row.releasedate, i + 2, "release date"),
            releaseStatus,
            items: Number(row.items || row.lineitems || 0) || 0,
            vendor: (row.vendor || row.supplier || "").trim(),
            estCost: Number(row.estcost || row.estimatedcost || 0) || 0,
            actualCost: Number(row.actualcost || 0) || 0,
            deliveryStatus,
            expectedDelivery: cleanDate(row.expecteddelivery, i + 2, "expected delivery"),
            actualDelivery: cleanDate(row.actualdelivery, i + 2, "actual delivery"),
            inspectionStatus,
            rejectionPct: Number(row.rejectionpct || row.rejection || 0) || 0,
            reworkCost: Number(row.reworkcost || 0) || 0,
          });
        });
        if (imported.length) {
          const nextBoms = [...boms, ...imported];
          setBoms(nextBoms);
          persist({ boms: nextBoms, activity: logAct(`${imported.length} BOM release${imported.length === 1 ? "" : "s"} imported via CSV`) });
        }
        setUploadResult({ count: imported.length, skipped });
      },
      error: () => setUploadResult({ count: 0, skipped: ["Could not read this file. Save it as CSV and try again."] }),
    });
  }

  function handleProjectCsv(input) {
    Papa.parse(input, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, ""),
      complete: (results) => {
        const imported = [];
        const skipped = [];
        const newDepts = new Set(departments);
        const newVerts = new Set(verticals);
        const cleanDate = (v, row, label) => {
          const d = (v || "").trim();
          if (d && isNaN(new Date(d).getTime())) { skipped.push(`Row ${row}: invalid ${label} "${d}" — imported without it`); return ""; }
          return d;
        };
        const num = (v) => Number(v || 0) || 0;
        results.data.forEach((row, i) => {
          const name = (row.name || row.project || row.projectname || "").trim();
          if (!name) { skipped.push(`Row ${i + 2}: missing project name`); return; }
          if (projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) { skipped.push(`Row ${i + 2}: project "${name}" already exists — skipped to avoid duplicates`); return; }
          const dept = (row.department || row.dept || "").trim() || departments[0] || "General";
          newDepts.add(dept);
          const vertical = (row.vertical || row.businessvertical || "").trim();
          if (vertical) newVerts.add(vertical);
          let status = (row.status || "On Track").trim();
          status = Object.keys(STATUS).find((s) => s.toLowerCase() === status.toLowerCase()) || "On Track";
          imported.push({
            id: "p" + Date.now() + "-" + i,
            name, department: dept, vertical, owner: (row.owner || "").trim(), status,
            startDate: cleanDate(row.startdate, i + 2, "start date"),
            endDate: cleanDate(row.enddate || row.targetenddate, i + 2, "end date"),
            baselineStart: cleanDate(row.baselinestart, i + 2, "baseline start"),
            baselineEnd: cleanDate(row.baselineend, i + 2, "baseline end"),
            percentComplete: Math.min(100, Math.max(0, num(row.percentcomplete || row.progress))),
            teamSize: num(row.teamsize), hoursAllocated: num(row.hoursallocated), hoursUsed: num(row.hoursused),
            budget: num(row.budget), actualCost: num(row.actualcost),
            committedCost: num(row.committedcost), retention: num(row.retention),
            revenue: num(row.revenue), cashIn: num(row.cashin), cashOut: num(row.cashout),
            payments: [], milestones: [], risks: [], issues: [], updates: [],
          });
        });
        if (imported.length) {
          const nextProjects = [...projects, ...imported];
          const nextDepts = Array.from(newDepts);
          const nextVerts = Array.from(newVerts);
          setProjects(nextProjects); setDepartments(nextDepts); setVerticals(nextVerts);
          persist({ projects: nextProjects, departments: nextDepts, verticals: nextVerts, activity: logAct(`${imported.length} project${imported.length === 1 ? "" : "s"} imported via CSV`) });
        }
        setUploadResult({ count: imported.length, skipped });
      },
      error: () => setUploadResult({ count: 0, skipped: ["Could not read this file. Save it as CSV and try again."] }),
    });
  }

  /* ---------- aggregates ---------- */
  const agg = useMemo(() => {
    const totBudget = projects.reduce((s, p) => s + (p.budget || 0), 0);
    const totActual = projects.reduce((s, p) => s + (p.actualCost || 0), 0);
    const totFcf = projects.reduce((s, p) => s + derived(p).fcf, 0);
    const withRev = projects.filter((p) => p.revenue > 0);
    const avgMargin = withRev.length ? withRev.reduce((s, p) => s + derived(p).margin, 0) / withRev.length : 0;
    const counts = { "On Track": 0, "At Risk": 0, "Delayed": 0, "Completed": 0 };
    projects.forEach((p) => { if (counts[p.status] !== undefined) counts[p.status]++; });
    return { totBudget, totActual, totFcf, avgMargin, counts };
  }, [projects]);

  const deptRows = useMemo(() => {
    const allDepts = [...new Set([...departments, ...projects.map((p) => p.department)])].filter(Boolean);
    return allDepts.map((dep) => {
      const ps = projects.filter((p) => p.department === dep);
      if (!ps.length) return null;
      const budget = ps.reduce((s, p) => s + (p.budget || 0), 0);
      const actual = ps.reduce((s, p) => s + (p.actualCost || 0), 0);
      const fcf = ps.reduce((s, p) => s + derived(p).fcf, 0);
      const withRev = ps.filter((p) => p.revenue > 0);
      const margin = withRev.length ? withRev.reduce((s, p) => s + derived(p).margin, 0) / withRev.length : 0;
      const avgProg = ps.reduce((s, p) => s + (p.percentComplete || 0), 0) / ps.length;
      const risk = ps.filter((p) => p.status === "At Risk" || p.status === "Delayed").length;
      return { dep, count: ps.length, budget, actual, variance: budget > 0 ? ((actual - budget) / budget) * 100 : 0, fcf, margin, avgProg, risk };
    }).filter(Boolean);
  }, [projects, departments]);

  const alerts = useMemo(() => buildAlerts(projects, marginTarget), [projects, marginTarget]);

  const verticalRows = useMemo(() => {
    const allVerts = [...new Set([...verticals, ...projects.map((p) => (p.vertical || "").trim())])].filter(Boolean);
    const keys = [...allVerts, "__none__"];
    return keys.map((v) => {
      const ps = projects.filter((p) => (v === "__none__" ? !(p.vertical || "").trim() : p.vertical === v));
      if (!ps.length) return null;
      const budget = ps.reduce((s, p) => s + (p.budget || 0), 0);
      const actual = ps.reduce((s, p) => s + (p.actualCost || 0), 0);
      const fcf = ps.reduce((s, p) => s + derived(p).fcf, 0);
      const pendIn = ps.reduce((s, p) => s + derived(p).pendIn, 0);
      const withRev = ps.filter((p) => p.revenue > 0);
      const margin = withRev.length ? withRev.reduce((s, p) => s + derived(p).margin, 0) / withRev.length : 0;
      return { v: v === "__none__" ? "Unassigned" : v, count: ps.length, budget, actual, fcf, pendIn, margin };
    }).filter(Boolean);
  }, [projects, verticals]);

  const taskAgg = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "Done").length;
    const overdue = tasks.filter(isOverdue).length;
    const blocked = tasks.filter((t) => t.status === "Blocked").length;
    const byDept = {};
    tasks.forEach((t) => {
      byDept[t.department] = byDept[t.department] || { open: 0, overdue: 0 };
      if (t.status !== "Done") byDept[t.department].open++;
      if (isOverdue(t)) byDept[t.department].overdue++;
    });
    return { open, overdue, blocked, byDept };
  }, [tasks]);

  const bomAgg = useMemo(() => {
    const released = boms.filter((b) => b.releaseStatus === "Released" || b.releaseStatus === "Revised").length;
    const draft = boms.filter((b) => b.releaseStatus === "Draft").length;
    const pendingDelivery = boms.filter((b) => b.deliveryStatus !== "Delivered").length;
    const overdue = boms.filter(bomDeliveryOverdue).length;
    const est = boms.reduce((s, b) => s + (b.estCost || 0), 0);
    const actual = boms.reduce((s, b) => s + (b.actualCost || 0), 0);
    return { released, draft, pendingDelivery, overdue, est, actual };
  }, [boms]);

  const bomAlerts = useMemo(() => {
    const list = [];
    boms.forEach((b) => {
      const label = b.bomNo || b.title;
      if (bomDeliveryOverdue(b)) list.push({ id: b.id + "-d", project: label, dept: "BOM", type: "Delivery overdue", detail: `Expected ${b.expectedDelivery}, still ${b.deliveryStatus.toLowerCase()}`, sev: "brick" });
      const cv = bomCostVariance(b);
      if (cv !== null && cv > 5) list.push({ id: b.id + "-c", project: label, dept: "BOM", type: "BOM cost overrun", detail: `Actual cost is ${pct(cv)} above estimate`, sev: "amber" });
    });
    return list;
  }, [boms]);

  /* ---------- Export to CSV / Excel ----------
     Builds flat rows per dataset. Excel export creates a multi-sheet
     workbook via SheetJS. Downloads can be blocked in some sandboxes,
     so a Copy-CSV fallback is always offered. */
  const r1 = (v) => (v === null || v === undefined || !isFinite(v) ? "" : Math.round(v * 10) / 10);
  function projectRows() {
    return projects.map((p) => {
      const d = derived(p);
      return {
        Name: p.name, Department: p.department, Vertical: p.vertical || "", Owner: p.owner || "", Status: p.status,
        StartDate: p.startDate || "", EndDate: p.endDate || "", BaselineStart: p.baselineStart || "", BaselineEnd: p.baselineEnd || "",
        SlippageDays: d.slippage === null ? "" : d.slippage, PercentComplete: p.percentComplete || 0,
        TeamSize: p.teamSize || 0, HoursAllocated: p.hoursAllocated || 0, HoursUsed: p.hoursUsed || 0,
        Budget: p.budget || 0, ActualCost: p.actualCost || 0, CommittedCost: p.committedCost || 0, Retention: p.retention || 0,
        Revenue: p.revenue || 0, CashIn: d.cashIn, CashOut: d.cashOut, FCF: d.fcf,
        CostVariancePct: r1(d.variance), NetMarginPct: r1(d.margin), ROIPct: d.roi === null ? "" : r1(d.roi),
        PaybackMonths: d.payback === null ? "" : r1(d.payback),
        Milestones: (p.milestones || []).length, OpenRisks: (p.risks || []).filter((r) => r.status !== "Closed").length,
        OpenIssues: (p.issues || []).filter((i) => i.status === "Open").length,
      };
    });
  }
  function taskRows() {
    return tasks.map((t) => ({
      Title: t.title, Department: t.department, Project: t.projectId ? projectName(t.projectId) : "",
      Assignee: t.assignee || "", StartDate: t.startDate || "", DueDate: t.dueDate || "",
      DurationDays: taskDuration(t) ?? "", Priority: t.priority, Status: t.status,
      Cost: t.cost || 0, EstHours: t.estHours || 0,
      DependsOn: t.dependsOn ? ((tasks.find((x) => x.id === t.dependsOn) || {}).title || "") : "",
      Overdue: isOverdue(t) ? "Yes" : "",
    }));
  }
  function bomRows() {
    return boms.map((b) => {
      const rd = bomReceiptDays(b);
      const cv = bomCostVariance(b);
      return {
        BomNo: b.bomNo, Title: b.title, Project: b.projectId ? projectName(b.projectId) : "", Revision: b.revision,
        ReleasedBy: b.releasedBy || "", ReleaseDate: b.releaseDate || "", ReleaseStatus: b.releaseStatus,
        Items: b.items || 0, Vendor: b.vendor || "", EstCost: b.estCost || 0, ActualCost: b.actualCost || 0,
        CostVariancePct: cv === null ? "" : r1(cv), DeliveryStatus: b.deliveryStatus,
        ExpectedDelivery: b.expectedDelivery || "", ActualDelivery: b.actualDelivery || "",
        ReceiptDays: rd ? rd.days : "", InspectionStatus: b.inspectionStatus || "Not Inspected",
        RejectionPct: b.rejectionPct || 0, ReworkCost: b.reworkCost || 0,
      };
    });
  }
  function resourceRows() {
    return resources.map((r) => ({
      Name: r.name, HomeDepartment: r.homeDept || "", Roles: [...r.roles].join(" / "), Departments: [...r.depts].join(" / "), Projects: [...r.projects].join(" / "),
      OpenTasks: r.open, DoneTasks: r.done, Blocked: r.blocked, Overdue: r.overdue,
      OpenEstHours: r.openHours, CapacityHoursPerWeek: capacities[r.name] ?? "", HourlyRate: rates[r.name] ?? "",
      OpenLaborCost: (Number(rates[r.name]) || 0) > 0 ? r.openHours * Number(rates[r.name]) : "",
      NextDue: r.nextDue || "", AssignedTaskCost: r.cost,
    }));
  }
  function paymentRowsAll() {
    return projects.flatMap((p) => (p.payments || []).map((pay) => ({
      Project: p.name, Label: pay.label || "", InvoiceNo: pay.invoiceNo || "", Date: pay.date || "",
      Amount: pay.amount || 0, Kind: pay.kind, Status: pay.status,
      OverdueDays: pay.status === "Pending" && pay.date && new Date(pay.date) < new Date() ? dayDiff(pay.date, new Date().toISOString().slice(0, 10)) : "",
    })));
  }
  function milestoneRowsAll() {
    return projects.flatMap((p) => (p.milestones || []).map((m) => ({ Project: p.name, Milestone: m.label, Planned: m.planned || "", Actual: m.actual || "", Status: m.actual ? "Done" : (m.planned && new Date(m.planned) < new Date() ? "Overdue" : "Upcoming") })));
  }
  function riskRowsAll() {
    return projects.flatMap((p) => (p.risks || []).map((r) => ({ Project: p.name, Risk: r.title, Owner: r.owner || "", Probability: r.probability, Impact: r.impact, Score: (r.probability || 0) * (r.impact || 0), Mitigation: r.mitigation || "", Status: r.status })));
  }
  function issueRowsAll() {
    return projects.flatMap((p) => (p.issues || []).map((i) => ({ Project: p.name, Date: i.date || "", Title: i.title, Type: i.type, CostImpact: i.costImpact || 0, TimeImpactDays: i.timeImpact || 0, Status: i.status })));
  }
  const EXPORT_SETS = {
    projects: { label: "Projects", rows: projectRows },
    tasks: { label: "Tasks", rows: taskRows },
    boms: { label: "BOM releases", rows: bomRows },
    resources: { label: "Resources", rows: resourceRows },
    payments: { label: "Payments & invoices", rows: paymentRowsAll },
    milestones: { label: "Milestones", rows: milestoneRowsAll },
    risks: { label: "Risk register", rows: riskRowsAll },
    issues: { label: "Issues & change requests", rows: issueRowsAll },
  };
  function tryDownload(content, filename, type) {
    try {
      const url = URL.createObjectURL(new Blob([content], { type }));
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) { return false; }
  }
  function exportCsv() {
    const set = EXPORT_SETS[exportKind];
    if (!set) return;
    tryDownload(Papa.unparse(set.rows()), `portfolio-${exportKind}.csv`, "text/csv");
  }
  function copyExportCsv() {
    const set = EXPORT_SETS[exportKind];
    if (!set) return;
    const text = Papa.unparse(set.rows());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
    }
  }
  function exportExcel(all) {
    try {
      const wb = XLSX.utils.book_new();
      const kinds = all ? Object.keys(EXPORT_SETS) : [exportKind];
      kinds.forEach((k) => {
        const rows = EXPORT_SETS[k].rows();
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No data" }]);
        XLSX.utils.book_append_sheet(wb, ws, EXPORT_SETS[k].label.slice(0, 31));
      });
      XLSX.writeFile(wb, all ? "portfolio-export.xlsx" : `portfolio-${exportKind}.xlsx`);
      setExportError("");
    } catch (e) {
      setExportError("Excel download was blocked on this device — use Copy CSV instead and paste into Excel or Google Sheets.");
    }
  }

  /* ---------- FULL BACKUP / RESTORE ----------
     The one feature that makes your data survive across app rebuilds
     and separate published links. A backup is a single JSON file
     holding EVERYTHING (projects, tasks, BOMs, departments, verticals,
     rates, capacities, people, links, settings). Restore loads it into
     ANY version of the app, so your data is never trapped in one
     instance's storage. */
  function snapshotData() {
    return {
      _format: "portfolio-tracker-backup",
      _version: "v3.6",
      _exportedAt: new Date().toISOString(),
      projects, tasks, boms, departments, verticals, currency, marginTarget,
      activity, capacities, rates, people, resourceDepts,
    };
  }
  function copyBackup() {
    const text = JSON.stringify(snapshotData(), null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => setBackupMsg("Couldn't copy automatically — select the text above manually and copy."));
    } else {
      setBackupMsg("Select the text above manually and copy it.");
    }
  }
  function downloadBackup() {
    const text = JSON.stringify(snapshotData(), null, 2);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const ok = tryDownload(text, `portfolio-backup-${stamp}.json`, "application/json");
    if (!ok) {
      setBackupMsg("Download blocked here — use Copy backup text above instead.");
    } else {
      setBackupMsg("Backup downloaded. Keep this file — restore it into any version of the app.");
    }
  }
  function applyRestore(obj) {
    if (!obj || obj._format !== "portfolio-tracker-backup") { setBackupMsg("That file isn't a valid portfolio backup."); return; }
    try {
      setProjects(obj.projects || []);
      setTasks(obj.tasks || []);
      setBoms(obj.boms || []);
      setDepartments(obj.departments && obj.departments.length ? obj.departments : DEFAULT_DEPARTMENTS);
      setVerticals(obj.verticals !== undefined ? obj.verticals : DEFAULT_VERTICALS);
      setCurrency(obj.currency || "₹");
      setMarginTarget(obj.marginTarget ?? 15);
      setActivity(obj.activity || []);
      setCapacities(obj.capacities || {});
      setRates(obj.rates || {});
      setPeople(obj.people || []);
      setResourceDepts(obj.resourceDepts || {});
      setLoadError(false); setSeedPreview(false);
      persist({
        projects: obj.projects || [], tasks: obj.tasks || [], boms: obj.boms || [],
        departments: obj.departments && obj.departments.length ? obj.departments : DEFAULT_DEPARTMENTS,
        verticals: obj.verticals !== undefined ? obj.verticals : DEFAULT_VERTICALS,
        currency: obj.currency || "₹", marginTarget: obj.marginTarget ?? 15,
        capacities: obj.capacities || {}, rates: obj.rates || {}, people: obj.people || [],
        resourceDepts: obj.resourceDepts || {},
        activity: logAct(`Data restored from backup (${(obj.projects || []).length} projects, ${(obj.tasks || []).length} tasks)`),
      });
      setBackupMsg(`Restored ${(obj.projects || []).length} projects, ${(obj.tasks || []).length} tasks, ${(obj.departments || []).length} departments, ${(obj.verticals || []).length} verticals.`);
    } catch (e) { setBackupMsg("Restore failed — the file may be corrupted."); }
  }
  function handleRestoreFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => { try { applyRestore(JSON.parse(e.target.result)); } catch (err) { setBackupMsg("Couldn't read that file — is it a valid backup .json?"); } };
    reader.onerror = () => setBackupMsg("Couldn't read that file.");
    reader.readAsText(file);
  }
  function restoreFromPaste() {
    if (!restorePaste.trim()) { setBackupMsg("Paste your backup JSON first."); return; }
    try { applyRestore(JSON.parse(restorePaste)); setRestorePaste(""); } catch (e) { setBackupMsg("That text isn't valid backup JSON."); }
  }

  /* ---------- resources (people) derived from tasks + projects ---------- */
  const resources = useMemo(() => {
    const map = {};
    const ensure = (name) => {
      const key = name.trim();
      if (!key) return null;
      if (!map[key]) map[key] = { name: key, depts: new Set(), projects: new Set(), roles: new Set(), tasks: [], open: 0, overdue: 0, blocked: 0, done: 0, cost: 0, nextDue: null, openHours: 0 };
      return map[key];
    };
    projects.forEach((p) => {
      const r = ensure(p.owner || "");
      if (r) { r.roles.add("Project owner"); r.depts.add(p.department); r.projects.add(p.name); }
    });
    people.forEach((n) => {
      const r = ensure(n);
      if (r && r.roles.size === 0) r.roles.add("Added manually");
    });
    // Link home department (assigned on the Resources tab) to each person
    Object.values(map).forEach((r) => {
      const hd = (resourceDepts[r.name] || "").trim();
      if (hd) { r.homeDept = hd; r.depts.add(hd); } else { r.homeDept = ""; }
    });
    tasks.forEach((t) => {
      const r = ensure(t.assignee || "");
      if (!r) return;
      r.roles.add("Task assignee");
      r.depts.add(t.department);
      if (t.projectId) { const p = projects.find((x) => x.id === t.projectId); if (p) r.projects.add(p.name); }
      r.tasks.push(t);
      if (t.status === "Done") r.done++; else { r.open++; r.openHours += t.estHours || 0; }
      if (t.status === "Blocked") r.blocked++;
      if (isOverdue(t)) r.overdue++;
      r.cost += t.cost || 0;
      if (t.status !== "Done" && t.dueDate && (!r.nextDue || t.dueDate < r.nextDue)) r.nextDue = t.dueDate;
    });
    return Object.values(map).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  }, [tasks, projects, people, resourceDepts]);
  const unassignedTasks = tasks.filter((t) => !(t.assignee || "").trim() && t.status !== "Done").length;

  const chartBudget = deptRows.map((r) => ({ name: r.dep, Budget: r.budget, Actual: r.actual }));
  const chartMargin = [...projects].filter((p) => p.revenue > 0)
    .map((p) => ({ name: p.name.length > 22 ? p.name.slice(0, 21) + "…" : p.name, margin: Math.round(derived(p).margin * 10) / 10 }))
    .sort((a, b) => b.margin - a.margin);

  const visible = projects.filter((p) =>
    (filterDept === "All" || p.department === filterDept) &&
    (filterVertical === "All" || (filterVertical === "Unassigned" ? !(p.vertical || "").trim() : p.vertical === filterVertical)) &&
    (filterStatus === "All" || p.status === filterStatus) &&
    (search.trim() === "" || (p.name + " " + p.owner).toLowerCase().includes(search.toLowerCase()))
  );

  const visibleTasks = tasks.filter((t) =>
    (taskDept === "All" || t.department === taskDept) &&
    (taskProject === "All" || t.projectId === taskProject) &&
    (taskStatusFilter === "All" || t.status === taskStatusFilter) &&
    (taskSearch.trim() === "" || (t.title + " " + (t.assignee || "")).toLowerCase().includes(taskSearch.toLowerCase()))
  );
  const projectName = (id) => (projects.find((p) => p.id === id) || {}).name || "—";
  const taskDeptGroups = departments.filter((d) => visibleTasks.some((t) => t.department === d));
  const orphanTasks = visibleTasks.filter((t) => !departments.includes(t.department));

  const visibleBoms = boms.filter((b) =>
    (bomProject === "All" || b.projectId === bomProject) &&
    (bomRelFilter === "All" || b.releaseStatus === bomRelFilter) &&
    (bomDelFilter === "All" || b.deliveryStatus === bomDelFilter) &&
    (bomSearch.trim() === "" || (b.bomNo + " " + b.title + " " + (b.vendor || "") + " " + (b.releasedBy || "")).toLowerCase().includes(bomSearch.toLowerCase()))
  );

  /* ---------- render ---------- */
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.body, color: T.slate }}>
        Loading portfolio data…
      </div>
    );
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{
      fontFamily: T.display, fontSize: 14, fontWeight: 700, cursor: "pointer",
      color: tab === id ? T.ink : T.faint, background: "transparent", border: "none",
      borderBottom: tab === id ? `3px solid ${T.teal}` : "3px solid transparent", padding: "10px 4px",
    }}>{label}</button>
  );

  const th = { fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${T.line}`, whiteSpace: "nowrap" };
  const td = { fontFamily: T.body, fontSize: 13, color: T.ink, padding: "10px 10px", borderBottom: `1px solid ${T.line}`, verticalAlign: "middle", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ minHeight: "100vh", background: T.bg }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid ${T.blue}; outline-offset: 1px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
        tr.rowhover:hover { background: ${T.bg}; }
      `}</style>

      {/* Header */}
      <header style={{ background: T.ink, padding: "18px 22px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontFamily: T.display, fontSize: 20, fontWeight: 700, color: "#FFF", letterSpacing: 0.2 }}>Project Portfolio Tracker</div>
            <div style={{ fontFamily: T.body, fontSize: 12, color: "#9FB0C4", marginTop: 2 }}>
              Timeline · Resources · Cost · Free cash flow · Profitability · <span style={{ color: "#7FD1C3", fontWeight: 700 }}>v3.8</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: T.body, fontSize: 11, color: saveState === "error" ? "#F5B7B1" : "#9FB0C4", minWidth: 90, textAlign: "right" }}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved · shared" : saveState === "error" ? "Save failed — retry" : lastSync ? `Synced ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Shared with team"}
            </span>
            <button onClick={() => refreshFromStorage(false)} title="Pull the latest shared data now"
              style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: "#FFF", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>↻ Sync</button>
            <button onClick={() => { setBackupMsg(""); setRestorePaste(""); setBackupText(JSON.stringify(snapshotData(), null, 2)); setShowBackup(true); }} title="Copy a backup that survives rebuilds, or restore one" style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: "#FFF", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>💾 Backup</button>
            <button onClick={() => { setCopied(false); setShowExport(true); }} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: "#FFF", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>⬇ Export</button>
            <button onClick={() => setShowSettings(true)} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: "#FFF", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>Settings</button>
            <button onClick={() => setModal("new")} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.ink, background: "#FFF", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>+ Add project</button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "14px 22px 60px" }}>
        {loadError && (
          <div style={{ background: T.brickSoft, border: `1px solid ${T.brick}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: T.body, fontSize: 13, color: T.brick, fontWeight: 600, flex: 1, minWidth: 240 }}>
              Couldn't reach your saved data just now. Your data is safe — nothing has been changed or overwritten. Press Sync to try again.
            </span>
            <button onClick={() => refreshFromStorage(false)} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.brick, border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer" }}>↻ Retry sync</button>
          </div>
        )}
        {seedPreview && (
          <div style={{ background: T.blueSoft, border: `1px solid ${T.blue}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: T.body, fontSize: 13, color: T.blue, fontWeight: 600, flex: 1, minWidth: 240 }}>
              This looks like a fresh workspace, so sample data is shown as a preview. Nothing is saved yet — start with the samples, or clear them to enter your own.
            </span>
            <button onClick={() => { setSeedPreview(false); persist({ projects: SAMPLE_PROJECTS, tasks: SAMPLE_TASKS, boms: SAMPLE_BOMS, departments: DEFAULT_DEPARTMENTS, verticals: DEFAULT_VERTICALS, activity: logAct("Started with sample data") }); }}
              style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.blue, border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Start with sample data</button>
            <button onClick={() => { setSeedPreview(false); setProjects([]); setTasks([]); setBoms([]); setDepartments(DEFAULT_DEPARTMENTS); setVerticals(DEFAULT_VERTICALS); persist({ projects: [], tasks: [], boms: [], departments: DEFAULT_DEPARTMENTS, verticals: DEFAULT_VERTICALS, activity: logAct("Started with empty workspace") }); }}
              style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Clear & start empty</button>
          </div>
        )}
        <nav style={{ display: "flex", gap: 22, borderBottom: `1px solid ${T.line}`, marginBottom: 18 }}>
          {tabBtn("overview", "Executive overview")}
          {tabBtn("projects", `Projects (${projects.length})`)}
          {tabBtn("tasks", `Tasks (${tasks.filter((t) => t.status !== "Done").length})`)}
          {tabBtn("boms", `BOM releases (${boms.length})`)}
          {tabBtn("resources", `Resources (${resources.length})`)}
          {tabBtn("timeline", "Timeline")}
          {tabBtn("setup", "Departments & Verticals")}
          {tabBtn("digest", "Digest")}
        </nav>

        {/* ================= OVERVIEW ================= */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <KPI label="Active projects" value={projects.filter((p) => p.status !== "Completed").length} sub={`${agg.counts["Completed"]} completed`} />
              <KPI label="On track / At risk / Delayed" value={`${agg.counts["On Track"]} · ${agg.counts["At Risk"]} · ${agg.counts["Delayed"]}`} />
              <KPI label="Budget vs spend" value={fmtMoney(agg.totActual, currency)} sub={`of ${fmtMoney(agg.totBudget, currency)} budgeted`} accent={agg.totActual > agg.totBudget ? T.brick : T.ink} />
              <KPI label="Portfolio FCF" value={fmtMoney(agg.totFcf, currency)} accent={agg.totFcf < 0 ? T.brick : T.teal} />
              <KPI label="Avg net margin" value={pct(agg.avgMargin)} sub={`target ${marginTarget}%`} accent={agg.avgMargin < marginTarget ? T.amber : T.teal} />
              <KPI label="Open tasks" value={taskAgg.open} sub={`${taskAgg.overdue} overdue · ${taskAgg.blocked} blocked`} accent={taskAgg.overdue > 0 ? T.brick : T.ink} />
              <KPI label="BOM releases" value={`${bomAgg.released} / ${boms.length}`} sub={`${bomAgg.pendingDelivery} pending delivery · ${bomAgg.overdue} overdue`} accent={bomAgg.overdue > 0 ? T.brick : T.ink} />
            </div>

            <HealthStrip projects={projects} currency={currency} onSelect={(p) => setModal(p)} />

            <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, overflowX: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink }}>
                  {ganttView === "projects" ? "Project timeline · Gantt" : "Task breakdown · Gantt with resources"}
                </div>
                <div style={{ display: "flex", gap: 4, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: 3 }}>
                  {[["projects", "Projects"], ["tasks", "Tasks + resources"]].map(([id, label]) => (
                    <button key={id} onClick={() => setGanttView(id)} style={{
                      fontFamily: T.body, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", borderRadius: 6, padding: "5px 12px",
                      background: ganttView === id ? T.ink : "transparent", color: ganttView === id ? "#FFF" : T.slate,
                    }}>{label}</button>
                  ))}
                </div>
              </div>
              <div style={{ minWidth: 640 }}>
                {ganttView === "projects"
                  ? <Gantt projects={projects} onSelect={(p) => setModal(p)} />
                  : <TaskGantt tasks={tasks} projects={projects} onSelectTask={(t) => setTaskModal(t)} />}
              </div>
            </div>

            {/* Department comparison */}
            <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, overflowX: "auto" }}>
              <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Department comparison</div>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead><tr>
                  <th style={th}>Department</th><th style={th}>Projects</th><th style={th}>Avg progress</th>
                  <th style={th}>Budget</th><th style={th}>Actual</th><th style={th}>Variance</th>
                  <th style={th}>FCF</th><th style={th}>Avg margin</th><th style={th}>At risk / delayed</th><th style={th}>Open tasks</th>
                </tr></thead>
                <tbody>
                  {deptRows.map((r) => (
                    <tr key={r.dep} className="rowhover">
                      <td style={{ ...td, fontWeight: 700 }}>{r.dep}</td>
                      <td style={td}>{r.count}</td>
                      <td style={td}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><ProgressBar value={r.avgProg} color={T.blue} /><span style={{ fontSize: 12, color: T.slate }}>{Math.round(r.avgProg)}%</span></div></td>
                      <td style={td}>{fmtMoney(r.budget, currency)}</td>
                      <td style={td}>{fmtMoney(r.actual, currency)}</td>
                      <td style={{ ...td, color: r.variance > 0 ? T.brick : T.teal, fontWeight: 600 }}>{r.variance > 0 ? "+" : ""}{pct(r.variance)}</td>
                      <td style={{ ...td, color: r.fcf < 0 ? T.brick : T.teal, fontWeight: 600 }}>{fmtMoney(r.fcf, currency)}</td>
                      <td style={{ ...td, color: r.margin < marginTarget ? T.amber : T.teal, fontWeight: 600 }}>{pct(r.margin)}</td>
                      <td style={{ ...td, color: r.risk ? T.brick : T.slate }}>{r.risk || "—"}</td>
                      <td style={td}>
                        {(taskAgg.byDept[r.dep] || {}).open || "—"}
                        {(taskAgg.byDept[r.dep] || {}).overdue > 0 && <span style={{ color: T.brick, fontWeight: 600, fontSize: 12 }}> ({taskAgg.byDept[r.dep].overdue} overdue)</span>}
                      </td>
                    </tr>
                  ))}
                  {!deptRows.length && <tr><td style={td} colSpan={10}>No projects yet — add your first project to see department rollups.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Business vertical comparison */}
            <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, overflowX: "auto" }}>
              <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>By business vertical</div>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead><tr>
                  <th style={th}>Vertical</th><th style={th}>Projects</th><th style={th}>Budget</th>
                  <th style={th}>Actual</th><th style={th}>FCF</th><th style={th}>Pending inflows</th><th style={th}>Avg margin</th>
                </tr></thead>
                <tbody>
                  {verticalRows.map((r) => (
                    <tr key={r.v} className="rowhover">
                      <td style={{ ...td, fontWeight: 700 }}>{r.v}</td>
                      <td style={td}>{r.count}</td>
                      <td style={td}>{fmtMoney(r.budget, currency)}</td>
                      <td style={td}>{fmtMoney(r.actual, currency)}</td>
                      <td style={{ ...td, color: r.fcf < 0 ? T.brick : T.teal, fontWeight: 600 }}>{fmtMoney(r.fcf, currency)}</td>
                      <td style={{ ...td, color: r.pendIn > 0 ? T.amber : T.slate, fontWeight: r.pendIn > 0 ? 600 : 400 }}>{r.pendIn ? fmtMoney(r.pendIn, currency) : "—"}</td>
                      <td style={{ ...td, color: r.margin < marginTarget ? T.amber : T.teal, fontWeight: 600 }}>{pct(r.margin)}</td>
                    </tr>
                  ))}
                  {!verticalRows.length && <tr><td style={td} colSpan={7}>Assign business verticals to projects to see this rollup.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Charts */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
              <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
                <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 8 }}>Budget vs actual by department</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartBudget} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={T.line} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontFamily: T.body, fontSize: 11, fill: T.slate }} axisLine={{ stroke: T.line }} tickLine={false} />
                    <YAxis tickFormatter={(v) => fmtMoney(v, currency)} tick={{ fontFamily: T.body, fontSize: 10, fill: T.faint }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip formatter={(v) => fmtMoney(v, currency)} contentStyle={{ fontFamily: T.body, fontSize: 12, borderRadius: 8, border: `1px solid ${T.line}` }} />
                    <Legend wrapperStyle={{ fontFamily: T.body, fontSize: 12 }} />
                    <Bar dataKey="Budget" fill={T.blue} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Actual" fill={T.teal} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
                <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 8 }}>Profitability ranking · net margin %</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartMargin} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke={T.line} horizontal={false} />
                    <XAxis type="number" tick={{ fontFamily: T.body, fontSize: 10, fill: T.faint }} axisLine={false} tickLine={false} unit="%" />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontFamily: T.body, fontSize: 11, fill: T.slate }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => v + "%"} contentStyle={{ fontFamily: T.body, fontSize: 12, borderRadius: 8, border: `1px solid ${T.line}` }} />
                    <ReferenceLine x={marginTarget} stroke={T.amber} strokeDasharray="4 3" />
                    <Bar dataKey="margin" radius={[0, 3, 3, 0]}>
                      {chartMargin.map((e, i) => <Cell key={i} fill={e.margin < 0 ? T.brick : e.margin < marginTarget ? T.amber : T.teal} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Alerts */}
            <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>
                Needs attention {(alerts.length + bomAlerts.length) ? `(${alerts.length + bomAlerts.length})` : ""}
              </div>
              {alerts.length + bomAlerts.length === 0 ? (
                <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate }}>No open alerts. Everything is within budget, schedule, and margin targets.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...alerts, ...bomAlerts].map((a) => (
                    <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderRadius: 8, background: a.sev === "brick" ? T.brickSoft : T.amberSoft, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: a.sev === "brick" ? T.brick : T.amber, textTransform: "uppercase", letterSpacing: 0.5, minWidth: 130 }}>{a.type}</span>
                      <span style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink }}>{a.project}</span>
                      <span style={{ fontFamily: T.body, fontSize: 12, color: T.slate }}>({a.dept}) — {a.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= PROJECTS ================= */}
        {tab === "projects" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 4, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: 3, width: "fit-content" }}>
              {[["table", "Table"], ["board", "Status board"], ["financials", "Financials"]].map(([id, label]) => (
                <button key={id} onClick={() => setProjSubTab(id)} style={{
                  fontFamily: T.body, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", borderRadius: 6, padding: "6px 14px",
                  background: projSubTab === id ? T.ink : "transparent", color: projSubTab === id ? "#FFF" : T.slate,
                }}>{label}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option>All</option>{[...new Set([...departments, ...projects.map((p) => p.department)])].filter(Boolean).map((d) => <option key={d}>{d}</option>)}
              </select>
              <select value={filterVertical} onChange={(e) => setFilterVertical(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option value="All">All verticals</option>
                {[...new Set([...verticals, ...projects.map((p) => p.vertical)])].filter(Boolean).map((v) => <option key={v}>{v}</option>)}
                <option>Unassigned</option>
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option>All</option>{Object.keys(STATUS).map((s) => <option key={s}>{s}</option>)}
              </select>
              <input placeholder="Search project or owner…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: T.body, fontSize: 12, color: T.faint }}>{visible.length} of {projects.length} projects</span>
                <button onClick={() => { setUploadResult(null); setPasteText(""); setShowTemplate(false); setUploadKind("projects"); setShowUpload(true); }} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.ink, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>⬆ Upload projects (CSV)</button>
                <button onClick={() => setModal("new")} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>+ Add project</button>
              </div>
            </div>

            {projSubTab === "table" && (<>
            <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead><tr>
                  <th style={th}>Project</th><th style={th}>Dept · Owner</th><th style={th}>Status</th>
                  <th style={th}>Timeline</th><th style={th}>Progress</th><th style={th}>Team · Hours</th>
                  <th style={th}>Budget / Actual</th><th style={th}>Var</th><th style={th}>FCF</th><th style={th}>Margin</th>
                </tr></thead>
                <tbody>
                  {visible.map((p) => {
                    const d = derived(p);
                    const exp = expectedProgress(p);
                    const sc = (STATUS[p.status] || STATUS["On Track"]).color;
                    return (
                      <tr key={p.id} className="rowhover" onClick={() => setModal(p)} style={{ cursor: "pointer" }}>
                        <td style={{ ...td, fontWeight: 700, maxWidth: 200 }}>{p.name}</td>
                        <td style={td}><div>{p.department}</div><div style={{ fontSize: 11, color: T.faint }}>{p.owner || "—"}{p.vertical ? ` · ${p.vertical}` : ""}</div></td>
                        <td style={td}><StatusBadge status={p.status} /></td>
                        <td style={{ ...td, fontSize: 12, color: T.slate, whiteSpace: "nowrap" }}>{p.startDate || "—"}<br />→ {p.endDate || "—"}</td>
                        <td style={td}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><ProgressBar value={p.percentComplete} color={sc} expected={p.status === "Completed" ? null : exp} /><span style={{ fontSize: 12 }}>{p.percentComplete}%</span></div></td>
                        <td style={{ ...td, fontSize: 12, color: T.slate }}>{p.teamSize} ppl<br />{p.hoursUsed}/{p.hoursAllocated} h {p.hoursAllocated > 0 && <span style={{ color: d.util > 100 ? T.brick : T.faint }}>({Math.round(d.util)}%)</span>}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtMoney(p.budget, currency)}<br /><span style={{ color: p.actualCost > p.budget ? T.brick : T.slate, fontSize: 12 }}>{fmtMoney(p.actualCost, currency)}</span></td>
                        <td style={{ ...td, color: d.variance > 0 ? T.brick : T.teal, fontWeight: 600 }}>{d.variance > 0 ? "+" : ""}{pct(d.variance)}</td>
                        <td style={{ ...td, color: d.fcf < 0 ? T.brick : T.teal, fontWeight: 600, whiteSpace: "nowrap" }}>{fmtMoney(d.fcf, currency)}</td>
                        <td style={{ ...td, color: d.margin < 0 ? T.brick : d.margin < marginTarget ? T.amber : T.teal, fontWeight: 600 }}>{p.revenue > 0 ? pct(d.margin) : "—"}</td>
                      </tr>
                    );
                  })}
                  {!visible.length && <tr><td style={td} colSpan={10}>No projects match these filters. Clear them or add a new project.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>Click any row to edit. The small dark tick on progress bars marks where the project should be today based on its dates.</div>
            </>)}

            {projSubTab === "board" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
                {Object.keys(STATUS).map((st) => {
                  const col = visible.filter((p) => p.status === st);
                  return (
                    <div key={st} style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 10, padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS[st].color }} />
                        <span style={{ fontFamily: T.display, fontSize: 13, fontWeight: 700, color: T.ink }}>{st}</span>
                        <span style={{ fontFamily: T.body, fontSize: 12, color: T.faint, marginLeft: "auto" }}>{col.length}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {col.map((p) => {
                          const d = derived(p);
                          return (
                            <div key={p.id} onClick={() => setModal(p)} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: 10, cursor: "pointer" }}>
                              <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: T.ink }}>{p.name}</div>
                              <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint, marginBottom: 6 }}>{p.department}{p.vertical ? ` · ${p.vertical}` : ""}{p.owner ? ` · ${p.owner}` : ""}</div>
                              <ProgressBar value={p.percentComplete} color={STATUS[st].color} expected={p.status === "Completed" ? null : expectedProgress(p)} />
                              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: T.body, fontSize: 11 }}>
                                <span style={{ color: T.slate }}>{p.percentComplete}%</span>
                                <span style={{ color: d.fcf < 0 ? T.brick : T.teal, fontWeight: 600 }}>{fmtMoney(d.fcf, currency)}</span>
                              </div>
                            </div>
                          );
                        })}
                        {!col.length && <div style={{ fontFamily: T.body, fontSize: 12, color: T.faint, padding: "8px 0" }}>None</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {projSubTab === "financials" && (
              <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead><tr>
                    <th style={th}>Project</th><th style={th}>Budget</th><th style={th}>Actual</th><th style={th}>Committed</th>
                    <th style={th}>Revenue</th><th style={th}>FCF</th><th style={th}>Margin</th><th style={th}>ROI</th><th style={th}>Payback</th>
                  </tr></thead>
                  <tbody>
                    {visible.map((p) => {
                      const d = derived(p);
                      return (
                        <tr key={p.id} className="rowhover" onClick={() => setModal(p)} style={{ cursor: "pointer" }}>
                          <td style={{ ...td, fontWeight: 700, maxWidth: 200 }}>{p.name}<div style={{ fontSize: 11, fontWeight: 400, color: T.faint }}>{p.department}</div></td>
                          <td style={td}>{fmtMoney(p.budget, currency)}</td>
                          <td style={{ ...td, color: p.actualCost > p.budget ? T.brick : T.ink }}>{fmtMoney(p.actualCost, currency)}</td>
                          <td style={td}>{fmtMoney(d.totalCommitted, currency)}</td>
                          <td style={td}>{fmtMoney(p.revenue, currency)}</td>
                          <td style={{ ...td, color: d.fcf < 0 ? T.brick : T.teal, fontWeight: 600, whiteSpace: "nowrap" }}>{fmtMoney(d.fcf, currency)}</td>
                          <td style={{ ...td, color: d.margin < 0 ? T.brick : d.margin < marginTarget ? T.amber : T.teal, fontWeight: 600 }}>{p.revenue > 0 ? pct(d.margin) : "—"}</td>
                          <td style={{ ...td, color: d.roi !== null && d.roi < 0 ? T.brick : T.teal, fontWeight: 600 }}>{d.roi === null ? "—" : pct(d.roi)}</td>
                          <td style={td}>{d.payback === null ? "—" : `${Math.round(d.payback * 10) / 10} mo`}</td>
                        </tr>
                      );
                    })}
                    {!visible.length && <tr><td style={td} colSpan={9}>No projects match these filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {/* ================= TASKS ================= */}
        {tab === "tasks" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select value={taskDept} onChange={(e) => setTaskDept(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option>All</option>{[...new Set([...departments, ...tasks.map((t) => t.department)])].filter(Boolean).map((d) => <option key={d}>{d}</option>)}
              </select>
              <select value={taskProject} onChange={(e) => setTaskProject(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option value="All">All projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option>All</option>{Object.keys(TASK_STATUS).map((s) => <option key={s}>{s}</option>)}
              </select>
              <input placeholder="Search task or assignee…" value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button onClick={() => { setUploadResult(null); setPasteText(""); setShowTemplate(false); setUploadKind("tasks"); setShowUpload(true); }} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.ink, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>⬆ Upload tasks (CSV)</button>
                <button onClick={() => setTaskModal("new")} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>+ Add task</button>
              </div>
            </div>

            {[...taskDeptGroups, ...(orphanTasks.length ? ["__other__"] : [])].map((dep) => {
              const group = dep === "__other__" ? orphanTasks : visibleTasks.filter((t) => t.department === dep);
              const label = dep === "__other__" ? "Other" : dep;
              const openCount = group.filter((t) => t.status !== "Done").length;
              const overdueCount = group.filter(isOverdue).length;
              return (
                <div key={dep} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${T.line}`, background: T.bg }}>
                    <span style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink }}>{label}</span>
                    <span style={{ fontFamily: T.body, fontSize: 12, color: T.slate }}>{openCount} open</span>
                    {overdueCount > 0 && <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.brick }}>{overdueCount} overdue</span>}
                    <span style={{ fontFamily: T.body, fontSize: 12, color: T.slate, marginLeft: "auto" }}>Total cost: <b>{fmtMoney(group.reduce((s, t) => s + (t.cost || 0), 0), currency)}</b></span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
                      <thead><tr>
                        <th style={{ ...th, width: 34 }}></th><th style={th}>Task</th><th style={th}>Project</th>
                        <th style={th}>Assignee</th><th style={th}>Start → Due</th><th style={th}>Duration</th><th style={th}>Cost</th><th style={th}>Priority</th><th style={th}>Status</th>
                      </tr></thead>
                      <tbody>
                        {group.map((t) => {
                          const dur = taskDuration(t);
                          return (
                            <tr key={t.id} className="rowhover" style={{ cursor: "pointer", opacity: t.status === "Done" ? 0.55 : 1 }} onClick={() => setTaskModal(t)}>
                              <td style={td} onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={t.status === "Done"} onChange={() => toggleTaskDone(t)} aria-label={`Mark ${t.title} done`} style={{ width: 16, height: 16, accentColor: T.teal, cursor: "pointer" }} />
                              </td>
                              <td style={{ ...td, fontWeight: 600, textDecoration: t.status === "Done" ? "line-through" : "none" }}>{t.title}</td>
                              <td style={{ ...td, fontSize: 12, color: T.slate }}>{t.projectId ? projectName(t.projectId) : "—"}</td>
                              <td style={{ ...td, fontSize: 12 }}>{t.assignee || "—"}</td>
                              <td style={{ ...td, fontSize: 12, color: isOverdue(t) ? T.brick : T.slate, fontWeight: isOverdue(t) ? 700 : 400, whiteSpace: "nowrap" }}>
                                {t.startDate || "—"} → {t.dueDate || "—"}{isOverdue(t) && " ⚠"}
                              </td>
                              <td style={{ ...td, fontSize: 12, color: T.slate, whiteSpace: "nowrap" }}>{dur !== null ? `${dur} d` : "—"}</td>
                              <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>{t.cost ? fmtMoney(t.cost, currency) : "—"}</td>
                              <td style={{ ...td, fontSize: 12, fontWeight: 600, color: (PRIORITY[t.priority] || PRIORITY.Medium).color }}>{t.priority}</td>
                              <td style={td}><TaskBadge status={t.status} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {!visibleTasks.length && (
              <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 24, fontFamily: T.body, fontSize: 13, color: T.slate, textAlign: "center" }}>
                No tasks match these filters. Add a task or upload a CSV to get started.
              </div>
            )}
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>Tick the checkbox to mark done · click a row to edit.</div>
          </div>
        )}
        {/* ================= BOM RELEASES ================= */}
        {tab === "boms" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <KPI label="Released" value={bomAgg.released} sub={`${bomAgg.draft} in draft`} />
              <KPI label="Pending delivery" value={bomAgg.pendingDelivery} sub={`${bomAgg.overdue} overdue`} accent={bomAgg.overdue > 0 ? T.brick : T.ink} />
              <KPI label="Estimated BOM cost" value={fmtMoney(bomAgg.est, currency)} />
              <KPI label="Actual BOM cost" value={fmtMoney(bomAgg.actual, currency)} sub={bomAgg.est > 0 ? `${bomAgg.actual > bomAgg.est ? "+" : ""}${pct(((bomAgg.actual - bomAgg.est) / bomAgg.est) * 100)} vs estimate` : ""} accent={bomAgg.actual > bomAgg.est ? T.brick : T.teal} />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select value={bomProject} onChange={(e) => setBomProject(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option value="All">All projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={bomRelFilter} onChange={(e) => setBomRelFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option>All</option>{Object.keys(BOM_STATUS).map((s) => <option key={s}>{s}</option>)}
              </select>
              <select value={bomDelFilter} onChange={(e) => setBomDelFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option>All</option>{Object.keys(DELIVERY_STATUS).map((s) => <option key={s}>{s}</option>)}
              </select>
              <input placeholder="Search BOM, vendor, engineer…" value={bomSearch} onChange={(e) => setBomSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button onClick={() => { setUploadResult(null); setPasteText(""); setShowTemplate(false); setUploadKind("boms"); setShowUpload(true); }} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.ink, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>⬆ Upload BOMs (CSV)</button>
                <button onClick={() => setBomModal("new")} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>+ Add BOM release</button>
              </div>
            </div>

            <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1020 }}>
                <thead><tr>
                  <th style={th}>BOM # · Rev</th><th style={th}>Title</th><th style={th}>Project</th>
                  <th style={th}>Released by · Date</th><th style={th}>Release status</th><th style={th}>Items</th>
                  <th style={th}>Vendor</th><th style={th}>Delivery</th><th style={th}>Receipt days</th><th style={th}>Quality</th><th style={th}>Est / Actual cost</th><th style={th}>Cost var</th>
                </tr></thead>
                <tbody>
                  {visibleBoms.map((b) => {
                    const cv = bomCostVariance(b);
                    const overdue = bomDeliveryOverdue(b);
                    const rd = bomReceiptDays(b);
                    const delay = bomDelayDays(b);
                    return (
                      <tr key={b.id} className="rowhover" style={{ cursor: "pointer" }} onClick={() => setBomModal(b)}>
                        <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{b.bomNo || "—"}<span style={{ color: T.faint, fontWeight: 400 }}> · Rev {b.revision || "A"}</span></td>
                        <td style={{ ...td, maxWidth: 180 }}>{b.title || "—"}</td>
                        <td style={{ ...td, fontSize: 12, color: T.slate }}>{b.projectId ? projectName(b.projectId) : "—"}</td>
                        <td style={{ ...td, fontSize: 12, color: T.slate }}>{b.releasedBy || "—"}<br />{b.releaseDate || "—"}</td>
                        <td style={td}><Pill label={b.releaseStatus} map={BOM_STATUS} /></td>
                        <td style={td}>{b.items || "—"}</td>
                        <td style={{ ...td, fontSize: 12, color: T.slate }}>{b.vendor || "—"}</td>
                        <td style={td}>
                          <Pill label={b.deliveryStatus} map={DELIVERY_STATUS} />
                          <div style={{ fontSize: 11, marginTop: 3, color: overdue ? T.brick : T.faint, fontWeight: overdue ? 700 : 400, whiteSpace: "nowrap" }}>
                            {b.deliveryStatus === "Delivered" && b.actualDelivery ? `Arrived ${b.actualDelivery}` : b.expectedDelivery ? `Due ${b.expectedDelivery}${overdue ? " ⚠" : ""}` : "No date set"}
                          </div>
                        </td>
                        <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>
                          {rd === null ? <span style={{ color: T.faint }}>— (needs release date)</span> : (
                            <>
                              <span style={{ fontWeight: 700, color: rd.done ? T.ink : T.slate }}>{rd.days} d{rd.done ? "" : " elapsed"}</span>
                              {delay !== null && delay !== 0 && (
                                <div style={{ fontSize: 11, fontWeight: 600, color: delay > 0 ? T.brick : T.teal }}>
                                  {delay > 0 ? `+${delay} d late` : `${Math.abs(delay)} d early`}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td style={td}>
                          <Pill label={b.inspectionStatus || "Not Inspected"} map={INSPECTION_STATUS} />
                          {((b.rejectionPct || 0) > 0 || (b.reworkCost || 0) > 0) && (
                            <div style={{ fontSize: 11, marginTop: 3, color: (b.rejectionPct || 0) > 0 ? T.brick : T.slate, whiteSpace: "nowrap" }}>
                              {(b.rejectionPct || 0) > 0 ? `${b.rejectionPct}% rejected` : ""}{(b.rejectionPct || 0) > 0 && (b.reworkCost || 0) > 0 ? " · " : ""}{(b.reworkCost || 0) > 0 ? `rework ${fmtMoney(b.reworkCost, currency)}` : ""}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtMoney(b.estCost, currency)}<br /><span style={{ fontSize: 12, color: b.actualCost > b.estCost ? T.brick : T.slate }}>{b.actualCost ? fmtMoney(b.actualCost, currency) : "—"}</span></td>
                        <td style={{ ...td, fontWeight: 600, color: cv === null ? T.faint : cv > 0 ? T.brick : T.teal }}>{cv === null ? "—" : (cv > 0 ? "+" : "") + pct(cv)}</td>
                      </tr>
                    );
                  })}
                  {!visibleBoms.length && <tr><td style={td} colSpan={12}>No BOM releases match these filters. Add one or upload a CSV from engineering.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>Click any row to update release, delivery, or cost details. Cost variance appears once actual cost is entered.</div>

            {/* Vendor performance scorecard */}
            {(() => {
              const byVendor = {};
              boms.forEach((b) => {
                const v = (b.vendor || "").trim();
                if (!v) return;
                if (!byVendor[v]) byVendor[v] = { vendor: v, count: 0, delivered: 0, onTime: 0, receiptDays: [], costVars: [], rejections: [], rework: 0 };
                const s = byVendor[v];
                s.count++;
                if (b.deliveryStatus === "Delivered" && b.actualDelivery) {
                  s.delivered++;
                  if (!b.expectedDelivery || dayDiff(b.expectedDelivery, b.actualDelivery) <= 0) s.onTime++;
                  const rd = bomReceiptDays(b);
                  if (rd && rd.done) s.receiptDays.push(rd.days);
                }
                const cv2 = bomCostVariance(b);
                if (cv2 !== null) s.costVars.push(cv2);
                if ((b.rejectionPct || 0) > 0) s.rejections.push(b.rejectionPct);
                s.rework += b.reworkCost || 0;
              });
              const rows = Object.values(byVendor).sort((a, b) => b.count - a.count);
              if (!rows.length) return null;
              const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
              return (
                <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, overflowX: "auto" }}>
                  <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Vendor performance scorecard</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                    <thead><tr>
                      <th style={th}>Vendor</th><th style={th}>BOMs</th><th style={th}>Delivered</th><th style={th}>On-time %</th>
                      <th style={th}>Avg receipt days</th><th style={th}>Avg cost var</th><th style={th}>Avg rejection</th><th style={th}>Rework cost</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((s) => {
                        const ot = s.delivered ? (s.onTime / s.delivered) * 100 : null;
                        const acv = avg(s.costVars);
                        const arj = avg(s.rejections);
                        const ard = avg(s.receiptDays);
                        return (
                          <tr key={s.vendor} className="rowhover">
                            <td style={{ ...td, fontWeight: 700 }}>{s.vendor}</td>
                            <td style={td}>{s.count}</td>
                            <td style={td}>{s.delivered} / {s.count}</td>
                            <td style={{ ...td, fontWeight: 600, color: ot === null ? T.faint : ot >= 90 ? T.teal : ot >= 70 ? T.amber : T.brick }}>{ot === null ? "—" : pct(ot)}</td>
                            <td style={td}>{ard === null ? "—" : `${Math.round(ard)} d`}</td>
                            <td style={{ ...td, fontWeight: 600, color: acv === null ? T.faint : acv > 0 ? T.brick : T.teal }}>{acv === null ? "—" : (acv > 0 ? "+" : "") + pct(acv)}</td>
                            <td style={{ ...td, color: arj === null ? T.faint : arj > 2 ? T.brick : T.slate }}>{arj === null ? "—" : pct(arj)}</td>
                            <td style={{ ...td, color: s.rework > 0 ? T.brick : T.slate }}>{s.rework ? fmtMoney(s.rework, currency) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}
        {/* ================= RESOURCES ================= */}
        {tab === "resources" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <KPI label="People" value={resources.length} sub="from tasks + project owners" />
              <KPI label="Overloaded" value={resources.filter((r) => r.open >= 4).length} sub="4+ open tasks" accent={resources.some((r) => r.open >= 4) ? T.amber : T.ink} />
              <KPI label="With overdue work" value={resources.filter((r) => r.overdue > 0).length} accent={resources.some((r) => r.overdue > 0) ? T.brick : T.ink} />
              <KPI label="Unassigned open tasks" value={unassignedTasks} sub="need an owner" accent={unassignedTasks > 0 ? T.amber : T.ink} />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input placeholder="Search person or department…" value={resourceSearch} onChange={(e) => setResourceSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }} />
              <select value={resourceDeptFilter} onChange={(e) => setResourceDeptFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }} title="Filter resources by department">
                <option value="All">All departments</option>
                {[...new Set([...departments, ...Object.values(resourceDepts)])].filter(Boolean).map((d) => <option key={d}>{d}</option>)}
              </select>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input placeholder="Add resource (name)" value={newResource} onChange={(e) => setNewResource(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { const v = newResource.trim(); if (v && !resources.some((r) => r.name.toLowerCase() === v.toLowerCase())) { const next = [...people, v]; const nd = newResourceDept ? { ...resourceDepts, [v]: newResourceDept } : resourceDepts; setPeople(next); setResourceDepts(nd); persist({ people: next, resourceDepts: nd, activity: logAct(`Resource "${v}" added${newResourceDept ? ` (${newResourceDept})` : ""}`) }); } setNewResource(""); } }}
                  style={{ ...inputStyle, maxWidth: 180 }} />
                <select value={newResourceDept} onChange={(e) => setNewResourceDept(e.target.value)} style={{ ...inputStyle, width: "auto" }} title="Department for the new resource">
                  <option value="">Department…</option>
                  {departments.map((d) => <option key={d}>{d}</option>)}
                </select>
                <button onClick={() => { const v = newResource.trim(); if (v && !resources.some((r) => r.name.toLowerCase() === v.toLowerCase())) { const next = [...people, v]; const nd = newResourceDept ? { ...resourceDepts, [v]: newResourceDept } : resourceDepts; setPeople(next); setResourceDepts(nd); persist({ people: next, resourceDepts: nd, activity: logAct(`Resource "${v}" added${newResourceDept ? ` (${newResourceDept})` : ""}`) }); } setNewResource(""); }}
                  style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>+ Add resource</button>
              </div>
              <span style={{ fontFamily: T.body, fontSize: 12, color: T.faint, marginLeft: "auto" }}>Sorted by open workload · click a row to see their tasks</span>
            </div>

            <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead><tr>
                  <th style={th}>Resource</th><th style={th}>Departments</th><th style={th}>Projects</th>
                  <th style={th}>Workload</th><th style={th}>Capacity h/wk</th><th style={th}>Rate/h</th><th style={th}>Utilization</th><th style={th}>Labor cost (open)</th><th style={th}>Open / Done</th><th style={th}>Overdue</th>
                  <th style={th}>Next due</th><th style={th}>Assigned task cost</th>
                </tr></thead>
                <tbody>
                  {resources
                    .filter((r) => (resourceDeptFilter === "All" || r.homeDept === resourceDeptFilter || r.depts.has(resourceDeptFilter)))
                    .filter((r) => resourceSearch.trim() === "" || (r.name + " " + [...r.depts].join(" ")).toLowerCase().includes(resourceSearch.toLowerCase()))
                    .map((r) => {
                      const maxOpen = Math.max(1, ...resources.map((x) => x.open));
                      const isOpen = expandedResource === r.name;
                      const cap = Number(capacities[r.name]) || 0;
                      /* Utilization: open estimated hours vs ~4 weeks of capacity */
                      const utilPct = cap > 0 ? (r.openHours / (cap * 4)) * 100 : null;
                      const utilColor = utilPct === null ? T.faint : utilPct > 100 ? T.brick : utilPct > 80 ? T.amber : T.teal;
                      return (
                        <React.Fragment key={r.name}>
                          <tr className="rowhover" style={{ cursor: "pointer" }} onClick={() => setExpandedResource(isOpen ? null : r.name)}>
                            <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>
                              {isOpen ? "▾ " : "▸ "}{r.name}
                              {r.tasks.length === 0 && !r.roles.has("Project owner") && (
                                <button onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirmRemoveResource === r.name) {
                                      const next = people.filter((n) => n.toLowerCase() !== r.name.toLowerCase());
                                      const nc = { ...capacities }; delete nc[r.name];
                                      const nr = { ...rates }; delete nr[r.name];
                                      const nd = { ...resourceDepts }; delete nd[r.name];
                                      setPeople(next); setCapacities(nc); setRates(nr); setResourceDepts(nd); setConfirmRemoveResource(null);
                                      persist({ people: next, capacities: nc, rates: nr, resourceDepts: nd, activity: logAct(`Resource "${r.name}" removed`) });
                                    } else {
                                      setConfirmRemoveResource(r.name);
                                      setTimeout(() => setConfirmRemoveResource((c) => (c === r.name ? null : c)), 4000);
                                    }
                                  }}
                                  title="Remove this resource"
                                  style={{ marginLeft: 8, fontFamily: T.body, fontSize: 11, fontWeight: 700, color: confirmRemoveResource === r.name ? "#FFF" : T.brick, background: confirmRemoveResource === r.name ? T.brick : T.brickSoft, border: "none", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                                  {confirmRemoveResource === r.name ? "Confirm?" : "✕ Remove"}
                                </button>
                              )}
                              <button onClick={(e) => {
                                  e.stopPropagation();
                                  let base = r.name + " (copy)"; let name = base; let n = 2;
                                  while (resources.some((x) => x.name.toLowerCase() === name.toLowerCase())) { name = r.name + ` (copy ${n})`; n++; }
                                  const next = [...people, name];
                                  const nc = { ...capacities }; if (capacities[r.name] !== undefined) nc[name] = capacities[r.name];
                                  const nr = { ...rates }; if (rates[r.name] !== undefined) nr[name] = rates[r.name];
                                  const nd = { ...resourceDepts }; if (r.homeDept) nd[name] = r.homeDept;
                                  setPeople(next); setCapacities(nc); setRates(nr); setResourceDepts(nd);
                                  persist({ people: next, capacities: nc, rates: nr, resourceDepts: nd, activity: logAct(`Resource "${r.name}" duplicated`) });
                                }}
                                title="Duplicate this resource (name, department, rate, capacity)"
                                style={{ marginLeft: 6, fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.ink, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                                ⧉ Duplicate
                              </button>
                              <div style={{ fontSize: 10, fontWeight: 400, color: T.faint }}>{[...r.roles].join(" · ")}</div>
                            </td>
                            <td style={{ ...td, fontSize: 12, color: T.slate }} onClick={(e) => e.stopPropagation()}>
                              <select value={r.homeDept || ""} title="Home department for this resource"
                                onChange={(e) => {
                                  const nd = { ...resourceDepts };
                                  if (e.target.value) nd[r.name] = e.target.value; else delete nd[r.name];
                                  setResourceDepts(nd); persist({ resourceDepts: nd, activity: logAct(`Resource "${r.name}" linked to ${e.target.value || "no"} department`) });
                                }}
                                style={{ ...inputStyle, width: 130, fontSize: 12, padding: "5px 8px" }}>
                                <option value="">— Not linked —</option>
                                {[...new Set([...departments, r.homeDept])].filter(Boolean).map((d) => <option key={d}>{d}</option>)}
                              </select>
                              {(() => { const other = [...r.depts].filter((d) => d !== r.homeDept); return other.length ? <div style={{ fontSize: 10, color: T.faint, marginTop: 3 }}>also works in: {other.join(", ")}</div> : null; })()}
                            </td>
                            <td style={{ ...td, fontSize: 12, color: T.slate, maxWidth: 200 }}>{[...r.projects].slice(0, 2).join(", ") || "—"}{r.projects.size > 2 ? ` +${r.projects.size - 2}` : ""}</td>
                            <td style={td}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <ProgressBar value={(r.open / maxOpen) * 100} color={r.overdue > 0 ? T.brick : r.open >= 4 ? T.amber : T.teal} />
                                <span style={{ fontSize: 12, color: T.slate, whiteSpace: "nowrap" }}>{r.open} open</span>
                              </div>
                            </td>
                            <td style={td} onClick={(e) => e.stopPropagation()}>
                              <input type="number" min="0" max="99" value={capacities[r.name] ?? ""} placeholder="—"
                                onChange={(e) => {
                                  const next = { ...capacities, [r.name]: e.target.value === "" ? undefined : Number(e.target.value) };
                                  if (next[r.name] === undefined) delete next[r.name];
                                  setCapacities(next); persist({ capacities: next });
                                }}
                                style={{ ...inputStyle, width: 64, fontSize: 12, padding: "5px 8px" }} title="Weekly capacity in hours" />
                            </td>
                            <td style={td} onClick={(e) => e.stopPropagation()}>
                              <input type="number" min="0" value={rates[r.name] ?? ""} placeholder="—"
                                onChange={(e) => {
                                  const next = { ...rates, [r.name]: e.target.value === "" ? undefined : Number(e.target.value) };
                                  if (next[r.name] === undefined) delete next[r.name];
                                  setRates(next); persist({ rates: next });
                                }}
                                style={{ ...inputStyle, width: 76, fontSize: 12, padding: "5px 8px" }} title={`Hourly cost rate (${currency}/hour)`} />
                            </td>
                            <td style={{ ...td, fontWeight: 600, color: utilColor, whiteSpace: "nowrap" }}>
                              {utilPct === null ? <span style={{ fontWeight: 400, color: T.faint }}>set capacity</span> : `${Math.round(utilPct)}%`}
                              {utilPct !== null && <div style={{ fontSize: 10, fontWeight: 400, color: T.faint }}>{r.openHours} h open / 4 wk</div>}
                            </td>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>
                              {(Number(rates[r.name]) || 0) > 0 && r.openHours > 0
                                ? <><b>{fmtMoney(r.openHours * Number(rates[r.name]), currency)}</b><div style={{ fontSize: 10, color: T.faint }}>{r.openHours} h × {fmtMoney(Number(rates[r.name]), currency)}/h</div></>
                                : <span style={{ color: T.faint }}>{(Number(rates[r.name]) || 0) > 0 ? "no open hours" : "set rate"}</span>}
                            </td>
                            <td style={{ ...td, fontSize: 12 }}>{r.open} / {r.done}{r.blocked > 0 && <span style={{ color: T.brick, fontWeight: 600 }}> · {r.blocked} blocked</span>}</td>
                            <td style={{ ...td, fontWeight: 600, color: r.overdue > 0 ? T.brick : T.slate }}>{r.overdue || "—"}</td>
                            <td style={{ ...td, fontSize: 12, color: T.slate, whiteSpace: "nowrap" }}>{r.nextDue || "—"}</td>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>{r.cost ? fmtMoney(r.cost, currency) : "—"}</td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td style={{ ...td, background: T.bg }} colSpan={12}>
                                {r.tasks.length === 0 ? (
                                  <span style={{ fontFamily: T.body, fontSize: 12, color: T.faint }}>No tasks assigned — appears here as a project owner.</span>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    {[...r.tasks].sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1).map((t) => (
                                      <div key={t.id} onClick={(e) => { e.stopPropagation(); setTaskModal(t); }}
                                        style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", cursor: "pointer", padding: "6px 10px", background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8 }}>
                                        <TaskBadge status={t.status} />
                                        <span style={{ fontFamily: T.body, fontSize: 12.5, fontWeight: 600, color: T.ink }}>{t.title}</span>
                                        <span style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>{t.projectId ? projectName(t.projectId) : t.department}</span>
                                        <span style={{ fontFamily: T.body, fontSize: 11, color: isOverdue(t) ? T.brick : T.slate, fontWeight: isOverdue(t) ? 700 : 400, marginLeft: "auto", whiteSpace: "nowrap" }}>
                                          {t.dueDate ? `due ${t.dueDate}` : "no due date"}{isOverdue(t) ? " ⚠" : ""}{t.cost ? ` · ${fmtMoney(t.cost, currency)}` : ""}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  {!resources.length && <tr><td style={td} colSpan={12}>No resources yet — assign people to tasks or set project owners to build this view.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* ================= TIMELINE (GANTT) ================= */}
        {tab === "timeline" && (() => {
          const tlProjects = projects.filter((p) =>
            (tlDept === "All" || p.department === tlDept) &&
            (tlVertical === "All" || (p.vertical || "") === tlVertical || (tlVertical === "Unassigned" && !(p.vertical || "").trim())) &&
            (tlStatus === "All" || p.status === tlStatus)
          );
          const tlProjIds = new Set(tlProjects.map((p) => p.id));
          const tlTasks = tasks.filter((t) => (t.projectId ? tlProjIds.has(t.projectId) : tlDept === "All") && (tlDept === "All" || t.department === tlDept));
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select value={tlDept} onChange={(e) => setTlDept(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                  <option value="All">All departments</option>
                  {[...new Set([...departments, ...projects.map((p) => p.department)])].filter(Boolean).map((d) => <option key={d}>{d}</option>)}
                </select>
                <select value={tlVertical} onChange={(e) => setTlVertical(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                  <option value="All">All verticals</option>
                  {[...new Set([...verticals, ...projects.map((p) => p.vertical)])].filter(Boolean).map((v) => <option key={v}>{v}</option>)}
                  <option>Unassigned</option>
                </select>
                <select value={tlStatus} onChange={(e) => setTlStatus(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                  <option value="All">All statuses</option>
                  {Object.keys(STATUS).map((s) => <option key={s}>{s}</option>)}
                </select>
                <div style={{ display: "flex", gap: 4, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: 3, marginLeft: "auto" }}>
                  {[["projects", "Projects"], ["tasks", "Tasks + resources"]].map(([id, label]) => (
                    <button key={id} onClick={() => setTlView(id)} style={{
                      fontFamily: T.body, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", borderRadius: 6, padding: "5px 12px",
                      background: tlView === id ? T.ink : "transparent", color: tlView === id ? "#FFF" : T.slate,
                    }}>{label}</button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <KPI label="Projects shown" value={tlProjects.length} sub={`of ${projects.length} total`} />
                <KPI label="On track / At risk / Delayed" value={`${tlProjects.filter((p) => p.status === "On Track").length} · ${tlProjects.filter((p) => p.status === "At Risk").length} · ${tlProjects.filter((p) => p.status === "Delayed").length}`} />
                <KPI label="Behind baseline" value={tlProjects.filter((p) => { const d = derived(p); return d.slippage !== null && d.slippage > 0; }).length} accent={T.amber} />
                <KPI label="Tasks shown" value={tlView === "tasks" ? tlTasks.length : "—"} />
              </div>

              <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, overflowX: "auto" }}>
                <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>
                  {tlView === "projects" ? "Project timeline" : "Task breakdown with resources"}
                </div>
                <div style={{ minWidth: 640 }}>
                  {tlProjects.length === 0 ? (
                    <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate }}>No projects match these filters.</div>
                  ) : tlView === "projects" ? (
                    <Gantt projects={tlProjects} onSelect={(p) => setModal(p)} />
                  ) : (
                    <TaskGantt tasks={tlTasks} projects={tlProjects} onSelectTask={(t) => setTaskModal(t)} />
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ================= DEPARTMENTS & VERTICALS SETUP ================= */}
        {tab === "setup" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, alignItems: "start" }}>
            {/* Departments manager */}
            <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Departments</div>
              <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint, marginBottom: 10 }}>Rename updates every project, task, and resource link. Delete only removes it from the list for new entries — records keep the name.</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <input style={inputStyle} placeholder="Add department" value={newDept} onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { const v = newDept.trim(); if (v && !departments.includes(v)) { const next = [...departments, v]; setDepartments(next); persist({ departments: next, activity: logAct(`Department "${v}" added`) }); } setNewDept(""); } }} />
                <button onClick={() => { const v = newDept.trim(); if (v && !departments.includes(v)) { const next = [...departments, v]; setDepartments(next); persist({ departments: next, activity: logAct(`Department "${v}" added`) }); } setNewDept(""); }}
                  style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Add</button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Department</th><th style={th}>Projects</th><th style={th}>Tasks</th><th style={th}>Resources</th><th style={{ ...th, textAlign: "right" }}>Actions</th>
                </tr></thead>
                <tbody>
                  {[...new Set([...departments, ...projects.map((p) => p.department), ...tasks.map((t) => t.department)])].filter(Boolean).map((d) => {
                    const inList = departments.includes(d);
                    const pc = projects.filter((p) => p.department === d).length;
                    const tc = tasks.filter((t) => t.department === d).length;
                    const rc = resources.filter((r) => r.homeDept === d || r.depts.has(d)).length;
                    const isRenaming = renaming && renaming.kind === "dept" && renaming.name === d;
                    return (
                      <tr key={d} className="rowhover">
                        <td style={{ ...td, fontWeight: 700 }}>
                          {isRenaming ? (
                            <input autoFocus style={{ ...inputStyle, width: "100%", fontSize: 13, padding: "5px 8px" }} value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") { renameDepartment(d, renameValue); setRenaming(null); } if (e.key === "Escape") setRenaming(null); }} />
                          ) : (
                            <>{d}{!inList && <div style={{ fontSize: 10, fontWeight: 400, color: T.amber }}>in records only — not offered for new entries</div>}</>
                          )}
                        </td>
                        <td style={td}>{pc || "—"}</td>
                        <td style={td}>{tc || "—"}</td>
                        <td style={td}>{rc || "—"}</td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          {isRenaming ? (
                            <>
                              <button onClick={() => { renameDepartment(d, renameValue); setRenaming(null); }} style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: "#FFF", background: T.teal, border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", marginRight: 4 }}>Save</button>
                              <button onClick={() => setRenaming(null)} style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.slate, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setRenaming({ kind: "dept", name: d }); setRenameValue(d); setConfirmDelDept(null); }} style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.blue, background: T.blueSoft, border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", marginRight: 4 }}>✎ Rename</button>
                              {inList ? (
                                <button onClick={() => {
                                    if (confirmDelDept === d) { const next = departments.filter((x) => x !== d); setDepartments(next); setConfirmDelDept(null); persist({ departments: next, activity: logAct(`Department "${d}" removed from list`) }); }
                                    else { setConfirmDelDept(d); setTimeout(() => setConfirmDelDept((c) => (c === d ? null : c)), 4000); }
                                  }}
                                  style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: confirmDelDept === d ? "#FFF" : T.brick, background: confirmDelDept === d ? T.brick : T.brickSoft, border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>
                                  {confirmDelDept === d ? "Confirm?" : "✕ Delete"}
                                </button>
                              ) : (
                                <button onClick={() => { const next = [...departments, d]; setDepartments(next); persist({ departments: next, activity: logAct(`Department "${d}" re-added to list`) }); }}
                                  style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.teal, background: T.tealSoft, border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>+ Re-add</button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!departments.length && !projects.length && <tr><td style={td} colSpan={5}>No departments yet — add your first above.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Verticals manager */}
            <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Business verticals</div>
              <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint, marginBottom: 10 }}>Rename updates every project using the vertical. Delete only removes it from the list for new entries.</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <input style={inputStyle} placeholder="Add business vertical" value={newVertical} onChange={(e) => setNewVertical(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { const v = newVertical.trim(); if (v && !verticals.includes(v)) { const next = [...verticals, v]; setVerticals(next); persist({ verticals: next, activity: logAct(`Vertical "${v}" added`) }); } setNewVertical(""); } }} />
                <button onClick={() => { const v = newVertical.trim(); if (v && !verticals.includes(v)) { const next = [...verticals, v]; setVerticals(next); persist({ verticals: next, activity: logAct(`Vertical "${v}" added`) }); } setNewVertical(""); }}
                  style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Add</button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Vertical</th><th style={th}>Projects</th><th style={th}>Budget</th><th style={{ ...th, textAlign: "right" }}>Actions</th>
                </tr></thead>
                <tbody>
                  {[...new Set([...verticals, ...projects.map((p) => (p.vertical || "").trim())])].filter(Boolean).map((v) => {
                    const inList = verticals.includes(v);
                    const ps = projects.filter((p) => p.vertical === v);
                    const isRenaming = renaming && renaming.kind === "vert" && renaming.name === v;
                    return (
                      <tr key={v} className="rowhover">
                        <td style={{ ...td, fontWeight: 700 }}>
                          {isRenaming ? (
                            <input autoFocus style={{ ...inputStyle, width: "100%", fontSize: 13, padding: "5px 8px" }} value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") { renameVertical(v, renameValue); setRenaming(null); } if (e.key === "Escape") setRenaming(null); }} />
                          ) : (
                            <>{v}{!inList && <div style={{ fontSize: 10, fontWeight: 400, color: T.amber }}>in records only — not offered for new entries</div>}</>
                          )}
                        </td>
                        <td style={td}>{ps.length || "—"}</td>
                        <td style={td}>{ps.length ? fmtMoney(ps.reduce((s, p) => s + (p.budget || 0), 0), currency) : "—"}</td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          {isRenaming ? (
                            <>
                              <button onClick={() => { renameVertical(v, renameValue); setRenaming(null); }} style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: "#FFF", background: T.teal, border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", marginRight: 4 }}>Save</button>
                              <button onClick={() => setRenaming(null)} style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.slate, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setRenaming({ kind: "vert", name: v }); setRenameValue(v); setConfirmDelVert(null); }} style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.blue, background: T.blueSoft, border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", marginRight: 4 }}>✎ Rename</button>
                              {inList ? (
                                <button onClick={() => {
                                    if (confirmDelVert === v) { const next = verticals.filter((x) => x !== v); setVerticals(next); setConfirmDelVert(null); persist({ verticals: next, activity: logAct(`Vertical "${v}" removed from list`) }); }
                                    else { setConfirmDelVert(v); setTimeout(() => setConfirmDelVert((c) => (c === v ? null : c)), 4000); }
                                  }}
                                  style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: confirmDelVert === v ? "#FFF" : T.brick, background: confirmDelVert === v ? T.brick : T.brickSoft, border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>
                                  {confirmDelVert === v ? "Confirm?" : "✕ Delete"}
                                </button>
                              ) : (
                                <button onClick={() => { const next = [...verticals, v]; setVerticals(next); persist({ verticals: next, activity: logAct(`Vertical "${v}" re-added to list`) }); }}
                                  style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.teal, background: T.tealSoft, border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>+ Re-add</button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!verticals.length && <tr><td style={td} colSpan={4}>No verticals yet — add your first above.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================= DIGEST ================= */}
        {tab === "digest" && (() => {
          const today = new Date(new Date().toDateString());
          const in7 = new Date(+today + 7 * 86400000);
          const inWindow = (d) => d && new Date(d) >= today && new Date(d) <= in7;
          const dueTasks = tasks.filter((t) => t.status !== "Done" && inWindow(t.dueDate)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
          const dueMilestones = projects.flatMap((p) => (p.milestones || []).filter((m) => !m.actual && inWindow(m.planned)).map((m) => ({ ...m, project: p.name, pObj: p })));
          const duePayments = projects.flatMap((p) => (p.payments || []).filter((pay) => pay.status === "Pending" && inWindow(pay.date)).map((pay) => ({ ...pay, project: p.name, pObj: p })));
          const latestUpdates = projects.map((p) => {
            const ups = [...(p.updates || [])].sort((a, b) => ((b.date || "") < (a.date || "") ? -1 : 1));
            return ups.length ? { ...ups[0], project: p.name, pObj: p } : null;
          }).filter(Boolean).sort((a, b) => ((b.date || "") < (a.date || "") ? -1 : 1));
          const allAlerts = [...alerts, ...bomAlerts];
          const digestCard = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 };
          const rowStyle = { display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "7px 10px", background: T.bg, borderRadius: 8, fontFamily: T.body, fontSize: 12.5, cursor: "pointer" };
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontFamily: T.display, fontSize: 16, fontWeight: 700, color: T.ink }}>Weekly digest · {today.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
                <button onClick={() => window.print()} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.ink, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>🖨 Print / save as PDF</button>
              </div>

              <div style={digestCard}>
                <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Needs attention now ({allAlerts.length})</div>
                {allAlerts.length === 0 ? <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate }}>No open alerts.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {allAlerts.slice(0, 12).map((a) => (
                      <div key={a.id} style={{ ...rowStyle, cursor: "default", background: a.sev === "brick" ? T.brickSoft : T.amberSoft }}>
                        <b style={{ color: a.sev === "brick" ? T.brick : T.amber }}>{a.type}</b>
                        <span style={{ fontWeight: 600, color: T.ink }}>{a.project}</span>
                        <span style={{ color: T.slate }}>{a.detail}</span>
                      </div>
                    ))}
                    {allAlerts.length > 12 && <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>+{allAlerts.length - 12} more on the Executive overview</div>}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
                <div style={digestCard}>
                  <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Tasks due in the next 7 days ({dueTasks.length})</div>
                  {dueTasks.length === 0 ? <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate }}>Nothing due this week.</div> : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {dueTasks.map((t) => (
                        <div key={t.id} style={rowStyle} onClick={() => setTaskModal(t)}>
                          <b style={{ color: T.ink }}>{t.title}</b>
                          <span style={{ color: T.slate }}>{t.assignee || "Unassigned"} · {t.department}</span>
                          <span style={{ marginLeft: "auto", color: T.slate, whiteSpace: "nowrap" }}>due {t.dueDate}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={digestCard}>
                  <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Milestones & payments this week ({dueMilestones.length + duePayments.length})</div>
                  {dueMilestones.length + duePayments.length === 0 ? <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate }}>No milestones or payments due this week.</div> : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {dueMilestones.map((m) => (
                        <div key={m.id} style={rowStyle} onClick={() => setModal(m.pObj)}>
                          <span style={{ color: T.amber }}>◆</span><b style={{ color: T.ink }}>{m.label}</b>
                          <span style={{ color: T.slate }}>{m.project}</span>
                          <span style={{ marginLeft: "auto", color: T.slate, whiteSpace: "nowrap" }}>{m.planned}</span>
                        </div>
                      ))}
                      {duePayments.map((pay) => (
                        <div key={pay.id} style={rowStyle} onClick={() => setModal(pay.pObj)}>
                          <span style={{ color: pay.kind === "Inflow" ? T.teal : T.slate }}>{pay.kind === "Inflow" ? "₹→" : "→₹"}</span>
                          <b style={{ color: T.ink }}>{pay.label || "Part payment"}</b>
                          <span style={{ color: T.slate }}>{pay.project}{pay.invoiceNo ? ` · ${pay.invoiceNo}` : ""}</span>
                          <span style={{ marginLeft: "auto", color: T.slate, whiteSpace: "nowrap" }}>{fmtMoney(pay.amount || 0, currency)} · {pay.date}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={digestCard}>
                <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Latest status updates from projects</div>
                {latestUpdates.length === 0 ? <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate }}>No status updates logged yet. Project owners can add weekly notes inside each project.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {latestUpdates.map((u) => (
                      <div key={u.id} style={{ ...rowStyle, alignItems: "flex-start" }} onClick={() => setModal(u.pObj)}>
                        <span style={{ color: T.faint, whiteSpace: "nowrap" }}>{u.date}</span>
                        <b style={{ color: T.ink, whiteSpace: "nowrap" }}>{u.project}</b>
                        <span style={{ color: T.slate, flex: 1, minWidth: 200 }}>{u.note}{u.by ? ` — ${u.by}` : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={digestCard}>
                <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Recent activity</div>
                {activity.length === 0 ? <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate }}>No activity recorded yet. Changes made from now on appear here.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {activity.slice(0, 20).map((a) => (
                      <div key={a.id} style={{ fontFamily: T.body, fontSize: 12, color: T.slate, display: "flex", gap: 10 }}>
                        <span style={{ color: T.faint, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{a.ts}</span>
                        <span>{a.action}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </main>

      {/* Modals */}
      {modal && (
        <ProjectModal
          project={modal === "new" ? null : modal}
          departments={departments}
          verticals={verticals}
          currency={currency}
          onSave={saveProject}
          onDelete={deleteProject}
          onDuplicate={duplicateProject}
          onClose={() => setModal(null)}
        />
      )}

      {taskModal && (
        <TaskModal
          task={taskModal === "new" ? null : taskModal}
          departments={departments}
          projects={projects}
          currency={currency}
          resourceNames={resources.map((r) => r.name)}
          allTasks={tasks}
          rates={rates}
          onSave={saveTask}
          onDelete={deleteTask}
          onDuplicate={duplicateTask}
          onClose={() => setTaskModal(null)}
        />
      )}

      {bomModal && (
        <BomModal
          bom={bomModal === "new" ? null : bomModal}
          projects={projects}
          currency={currency}
          onSave={saveBom}
          onDelete={deleteBom}
          onDuplicate={duplicateBom}
          onClose={() => setBomModal(null)}
        />
      )}

      {showUpload && (
        <div onClick={() => setShowUpload(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,28,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, width: "100%", maxWidth: 480, padding: 22, boxShadow: "0 24px 60px rgba(16,28,46,.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontFamily: T.display, fontSize: 18, fontWeight: 700, color: T.ink, margin: 0 }}>{uploadKind === "boms" ? "Upload BOM releases (CSV)" : uploadKind === "projects" ? "Upload projects (CSV)" : "Upload tasks (CSV)"}</h2>
              <button onClick={() => setShowUpload(false)} style={{ border: "none", background: "transparent", fontSize: 20, color: T.faint, cursor: "pointer" }} aria-label="Close">✕</button>
            </div>
            <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate, lineHeight: 1.5, marginBottom: 12 }}>
              {uploadKind === "boms"
                ? <>Upload a CSV with columns <b>bomNo, title, project, revision, releasedBy, releaseDate, releaseStatus, items, vendor, estCost, actualCost, deliveryStatus, expectedDelivery, actualDelivery, inspectionStatus, rejectionPct, reworkCost</b>. A BOM number or title is required — the rest use sensible defaults. Project names are matched to existing projects. Imported BOMs are shared with the whole team.</>
                : uploadKind === "projects"
                ? <>Upload a CSV with columns <b>name, department, vertical, owner, status, startDate, endDate, baselineStart, baselineEnd, percentComplete, teamSize, hoursAllocated, hoursUsed, budget, actualCost, committedCost, retention, revenue, cashIn, cashOut</b>. Only <b>name</b> is required — the rest use sensible defaults. New departments and verticals are added automatically; duplicate project names are skipped. Milestones, risks, and payments can be added afterwards by editing each project. Imported projects are shared with the whole team.</>
                : <>Upload a CSV with columns <b>title, department, project, assignee, startDate, dueDate, priority, status, cost, estHours</b>. Only <b>title</b> is required — the rest use sensible defaults. Project names are matched to existing projects; new department names are added automatically. Imported tasks are shared with the whole team.</>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <button onClick={downloadExcelTemplate} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.teal, background: T.tealSoft, border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>
                ⬇ Excel template (.xlsx)
              </button>
              <button onClick={copyTemplate} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.blue, background: T.blueSoft, border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>
                {copied ? "✓ Copied!" : "⧉ Copy CSV template"}
              </button>
              <button onClick={() => setShowTemplate((v) => !v)} style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.slate, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>
                {showTemplate ? "Hide template" : "View template"}
              </button>
            </div>
            {showTemplate && (
              <textarea readOnly value={uploadKind === "boms" ? BOM_CSV_TEMPLATE : uploadKind === "projects" ? PROJECT_CSV_TEMPLATE : CSV_TEMPLATE} onFocus={(e) => e.target.select()}
                style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11, height: 84, marginBottom: 10, resize: "vertical" }} />
            )}
            <label style={{ display: "block", border: `2px dashed ${T.line}`, borderRadius: 10, padding: "20px 16px", textAlign: "center", cursor: "pointer", background: T.bg }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleCsvFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
              <input type="file" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: "none" }}
                onChange={(e) => { handleCsvFile(e.target.files && e.target.files[0]); e.target.value = ""; }} />
              <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink }}>Choose a CSV or Excel file</div>
              <div style={{ fontFamily: T.body, fontSize: 12, color: T.faint, marginTop: 4 }}>.csv, .xlsx, .xls — or drag and drop it here (first sheet is imported)</div>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 8px" }}>
              <div style={{ flex: 1, height: 1, background: T.line }} />
              <span style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>OR paste CSV rows (works if file picking is blocked)</span>
              <div style={{ flex: 1, height: 1, background: T.line }} />
            </div>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              placeholder={"Paste CSV here, including the header row, e.g.\n" + (uploadKind === "boms" ? "bomNo,title,project,..." : "title,department,project,...")}
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11, height: 90, resize: "vertical" }} />
            <button onClick={() => { handleCsvFile(pasteText); setPasteText(""); }} disabled={!pasteText.trim()}
              style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: pasteText.trim() ? T.teal : T.faint, border: "none", borderRadius: 8, padding: "9px 18px", cursor: pasteText.trim() ? "pointer" : "not-allowed", marginTop: 8 }}>
              Import pasted CSV
            </button>
            {uploadResult && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: uploadResult.count ? T.teal : T.brick }}>
                  {uploadResult.count ? `Imported ${uploadResult.count} ${uploadKind === "boms" ? "BOM release" : uploadKind === "projects" ? "project" : "task"}${uploadResult.count === 1 ? "" : "s"}.` : `No ${uploadKind === "boms" ? "BOM releases" : uploadKind === "projects" ? "projects" : "tasks"} were imported.`}
                </div>
                {uploadResult.skipped.length > 0 && (
                  <div style={{ marginTop: 6, maxHeight: 120, overflowY: "auto", background: T.amberSoft, borderRadius: 8, padding: "8px 12px" }}>
                    {uploadResult.skipped.map((s, i) => (
                      <div key={i} style={{ fontFamily: T.body, fontSize: 12, color: T.amber }}>{s}</div>
                    ))}
                  </div>
                )}
                {uploadResult.count > 0 && (
                  <button onClick={() => setShowUpload(false)} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", marginTop: 10 }}>
                    Done — view {uploadKind === "boms" ? "BOM releases" : uploadKind === "projects" ? "projects" : "tasks"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showBackup && (
        <div onClick={() => setShowBackup(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,28,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, width: "100%", maxWidth: 500, maxHeight: "92vh", overflowY: "auto", padding: 22, boxShadow: "0 24px 60px rgba(16,28,46,.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontFamily: T.display, fontSize: 18, fontWeight: 700, color: T.ink, margin: 0 }}>Backup &amp; Restore</h2>
              <button onClick={() => setShowBackup(false)} style={{ border: "none", background: "transparent", fontSize: 20, color: T.faint, cursor: "pointer" }} aria-label="Close">✕</button>
            </div>
            <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate, lineHeight: 1.5, marginBottom: 14 }}>
              A backup is one file holding <b>all</b> your data — projects, tasks, BOMs, departments, verticals, rates, and settings. It's the reliable way to move everything into a new version or a newly published link. <b>Download a backup before switching versions, then Restore it in the new one.</b>
            </div>

            <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Backup</div>
            <div style={{ fontFamily: T.body, fontSize: 12, color: T.slate, marginBottom: 8 }}>
              Your full backup text is below. <b>Select all and copy it</b>, then paste into a plain text file saved as <b>my-backup.json</b>. (Downloads are often blocked in the published app, so copy is the reliable way.)
            </div>
            <textarea readOnly value={backupText} onFocus={(e) => e.target.select()}
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 10, height: 120, resize: "vertical", marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <button onClick={copyBackup} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.teal, border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer" }}>
                {copied ? "✓ Copied!" : "⧉ Copy backup text"}
              </button>
            </div>

            <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Restore</div>
            <div style={{ fontFamily: T.body, fontSize: 12, color: T.slate, marginBottom: 8 }}>Restoring replaces the current data with the backup's contents.</div>
            <label style={{ display: "block", border: `2px dashed ${T.line}`, borderRadius: 10, padding: "18px 16px", textAlign: "center", cursor: "pointer", background: T.bg, marginBottom: 10 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleRestoreFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
              <input type="file" accept=".json,application/json" style={{ display: "none" }}
                onChange={(e) => { handleRestoreFile(e.target.files && e.target.files[0]); e.target.value = ""; }} />
              <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: T.ink }}>Choose a backup .json file</div>
              <div style={{ fontFamily: T.body, fontSize: 12, color: T.faint, marginTop: 4 }}>or drag and drop it here</div>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 8px" }}>
              <div style={{ flex: 1, height: 1, background: T.line }} />
              <span style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>OR paste backup text (if file picking is blocked)</span>
              <div style={{ flex: 1, height: 1, background: T.line }} />
            </div>
            <textarea value={restorePaste} onChange={(e) => setRestorePaste(e.target.value)} placeholder="Paste the contents of a backup .json file here"
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11, height: 80, resize: "vertical" }} />
            <button onClick={restoreFromPaste} disabled={!restorePaste.trim()}
              style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: restorePaste.trim() ? T.ink : T.faint, border: "none", borderRadius: 8, padding: "9px 18px", cursor: restorePaste.trim() ? "pointer" : "not-allowed", marginTop: 8 }}>
              Restore from pasted text
            </button>

            {backupMsg && <div style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: backupMsg.toLowerCase().includes("fail") || backupMsg.toLowerCase().includes("isn't") || backupMsg.toLowerCase().includes("couldn't") || backupMsg.toLowerCase().includes("blocked") ? T.brick : T.teal, marginTop: 12, padding: "8px 12px", background: T.bg, borderRadius: 8 }}>{backupMsg}</div>}
          </div>
        </div>
      )}

      {showExport && (
        <div onClick={() => setShowExport(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,28,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, width: "100%", maxWidth: 460, padding: 22, boxShadow: "0 24px 60px rgba(16,28,46,.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontFamily: T.display, fontSize: 18, fontWeight: 700, color: T.ink, margin: 0 }}>Export data</h2>
              <button onClick={() => setShowExport(false)} style={{ border: "none", background: "transparent", fontSize: 20, color: T.faint, cursor: "pointer" }} aria-label="Close">✕</button>
            </div>
            <div style={{ fontFamily: T.body, fontSize: 13, color: T.slate, lineHeight: 1.5, marginBottom: 12 }}>
              Choose a dataset and format. <b>Excel — all data</b> creates one workbook with a sheet per dataset (projects, tasks, BOMs, resources, payments, milestones, risks, issues) — ready for board decks and offline analysis.
            </div>
            <Field label="Dataset">
              <select style={inputStyle} value={exportKind} onChange={(e) => setExportKind(e.target.value)}>
                {Object.entries(EXPORT_SETS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.rows().length} rows)</option>)}
              </select>
            </Field>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <button onClick={() => exportExcel(false)} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.teal, border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>⬇ Excel (.xlsx)</button>
              <button onClick={() => exportExcel(true)} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>⬇ Excel — all data</button>
              <button onClick={exportCsv} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>⬇ CSV</button>
              <button onClick={copyExportCsv} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.blue, background: T.blueSoft, border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>{copied ? "✓ Copied!" : "⧉ Copy CSV"}</button>
            </div>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint, marginTop: 10 }}>
              If downloads are blocked on your device, use <b>Copy CSV</b> and paste into Excel or Google Sheets.
            </div>
            {exportError && <div style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.brick, marginTop: 8 }}>{exportError}</div>}
          </div>
        </div>
      )}

      {showSettings && (
        <div onClick={() => setShowSettings(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,28,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, width: "100%", maxWidth: 420, padding: 22 }}>
            <h2 style={{ fontFamily: T.display, fontSize: 18, fontWeight: 700, color: T.ink, marginTop: 0 }}>Settings</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Currency">
                <select style={inputStyle} value={currency} onChange={(e) => { setCurrency(e.target.value); persist({ currency: e.target.value }); }}>
                  {Object.keys(CURRENCIES).map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Net margin target (%)">
                <input type="number" style={inputStyle} value={marginTarget} onChange={(e) => { const v = Number(e.target.value) || 0; setMarginTarget(v); persist({ marginTarget: v }); }} />
              </Field>
              <div style={{ fontFamily: T.body, fontSize: 12, color: T.slate, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, padding: "10px 12px" }}>
                Departments and business verticals are managed in the <b>Departments &amp; Verticals</b> tab — add, rename (updates all records), or delete them there.
              </div>
              <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button onClick={() => { if (resetArmed) { setResetArmed(false); resetAll(); } else { setResetArmed(true); setTimeout(() => setResetArmed(false), 5000); } }}
                  style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: resetArmed ? "#FFF" : T.brick, background: resetArmed ? T.brick : T.brickSoft, border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>
                  {resetArmed ? "Click again — clears data for everyone" : "Reset all data"}
                </button>
                <button onClick={() => setShowSettings(false)} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: "#FFF", background: T.ink, border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer" }}>Done</button>
              </div>
              <div style={{ fontFamily: T.body, fontSize: 11, color: T.faint }}>
                Data is stored in shared storage — everyone who opens this app sees and edits the same projects. Use ✎ to rename a department or vertical everywhere at once (all projects, tasks, and resource links update). ✕ only removes it from the list for new entries — existing records keep the old name.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
