"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import type { NavItem } from "@/components/AppShell";
import { ActivityFeed } from "@/components/ActivityFeed";
import { DataTable, LifecyclePips } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import { Drawer } from "@/components/Drawer";
import { LifecycleStepper } from "@/components/LifecycleStepper";
import type { Stage } from "@/components/LifecycleStepper";
import { Panel } from "@/components/Panel";
import { EnvTag, Pill, PriorityTag, RiskLabel } from "@/components/Pill";
import { ThemeProvider, ThemeToggle } from "@/components/ThemeProvider";
import { Tile } from "@/components/Tile";
import { Timeline } from "@/components/Timeline";
import { ToastProvider, toast } from "@/components/Toasts";

/**
 * `/dev/components` — a live catalogue of every design-system component, each
 * wired with representative props and rendered inside the real `ThemeProvider`
 * so the light / dark tokens can be eyeballed side by side.
 *
 * Dev- and test-only: `src/middleware.ts` 404s `/dev/*` in production and treats
 * it as public everywhere else.
 */

const wrap: CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "28px 24px 120px",
};
const header: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
};
const sectionStyle: CSSProperties = { marginTop: 44 };
const h2Style: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.09em",
  color: "var(--text-3)",
  borderBottom: "1px solid var(--border)",
  paddingBottom: 6,
  marginBottom: 16,
};
const captionStyle: CSSProperties = {
  color: "var(--text-3)",
  fontSize: 12,
  margin: "0 0 8px",
};
const row: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
};
const grid: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
};
const twoUp: CSSProperties = {
  display: "grid",
  gap: 20,
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  alignItems: "start",
};
const shellFrame: CSSProperties = {
  position: "relative",
  height: 520,
  overflow: "hidden",
  // `contain` makes this a containing block for AppShell's `position: fixed`
  // mobile bottom-bar, so at a narrow viewport it stays inside the frame
  // instead of overlaying the sections below.
  contain: "layout paint",
  border: "1px solid var(--border)",
  borderRadius: 12,
};
const button: CSSProperties = {
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  padding: "7px 13px",
  background: "var(--surface)",
  fontWeight: 600,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>{title}</h2>
      {children}
    </section>
  );
}

function navIcon(d: string): ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const NAV: NavItem[] = [
  {
    key: "overview",
    label: "Overview",
    href: "#appshell",
    icon: navIcon("M4 13h7V4H4zM13 20h7v-9h-7zM13 8h7V4h-7zM4 20h7v-4H4z"),
  },
  {
    key: "changes",
    label: "Changes",
    href: "#datatable",
    icon: navIcon("M4 7h16M4 12h16M4 17h10"),
    badge: 3,
  },
  {
    key: "incidents",
    label: "Incidents",
    href: "#timeline",
    icon: navIcon("M12 3l9 16H3zM12 10v4M12 17h.01"),
  },
];

type ChangeRow = { id: string; title: string; owner: string };

const CHANGE_ROWS: ChangeRow[] = [
  { id: "CHG-0041", title: "Rotate TLS certificates", owner: "Priya N." },
  { id: "CHG-0042", title: "Migrate auth to mTLS", owner: "Kai R." },
  { id: "CHG-0043", title: "Upgrade Postgres to 16", owner: "Devon L." },
  { id: "CHG-0044", title: "Add a read replica", owner: "Sam T." },
];

const CHANGE_COLUMNS: Column<ChangeRow>[] = [
  {
    key: "id",
    header: "Ref",
    width: "112px",
    cell: (r) => <span className="mono">{r.id}</span>,
  },
  { key: "title", header: "Title", cell: (r) => r.title },
  { key: "owner", header: "Owner", cell: (r) => r.owner },
];

/** The same register plus a trailing actions column — the cell's own button
 *  fires only its own handler, never the row's `onRowClick`. */
const CHANGE_COLUMNS_WITH_ACTIONS: Column<ChangeRow>[] = [
  ...CHANGE_COLUMNS,
  {
    key: "actions",
    header: "",
    width: "96px",
    cell: (r) => (
      <button
        type="button"
        style={{ ...button, padding: "5px 10px", fontWeight: 500 }}
        onClick={() => toast(`Editing ${r.id}`)}
      >
        Edit
      </button>
    ),
  },
];

const PIP_STAGES = ["Intake", "Assess", "Build", "Review", "Deploy"];

/** Seed for the interactive stepper. `assess` is the current stage; its gate is
 *  half-done so the Advance button starts disabled. */
const INITIAL_LIFECYCLE: Stage[] = [
  {
    key: "intake",
    label: "Intake",
    purpose: "Capture the request and its business context.",
    gate: [
      { key: "sponsor", label: "Requester and sponsor recorded", done: true },
      { key: "summary", label: "Change summary written", done: true },
    ],
  },
  {
    key: "assess",
    label: "Assess",
    purpose: "Weigh risk and impact; attach the rollback plan.",
    gate: [
      { key: "risk", label: "Risk level assessed", done: true },
      {
        key: "rollback",
        label: "Rollback plan attached",
        hint: "required for MEDIUM and above",
        done: false,
      },
      { key: "peer", label: "Peer review complete", done: false },
    ],
  },
  {
    key: "build",
    label: "Build",
    purpose: "Implement the change behind a pull request.",
    gate: [
      { key: "pr", label: "Pull request opened", done: false },
      { key: "ci", label: "CI green on the branch", done: false },
    ],
  },
  {
    key: "review",
    label: "Review",
    purpose: "Final approvals before the deployment window.",
    gate: [
      { key: "tech", label: "Technical approval", done: false },
      { key: "business", label: "Business approval", done: false },
    ],
  },
];

const CURRENT_STAGE_KEY = "assess";

/** `assess` current with every gate checked — for the blocked-Advance demo: the
 *  gates are complete but the server still returns `canAdvance: false`, and
 *  `blockedReason` explains why. */
const LIFECYCLE_ASSESS_DONE: Stage[] = INITIAL_LIFECYCLE.map((s) =>
  s.key === "assess"
    ? { ...s, gate: s.gate.map((g) => ({ ...g, done: true })) }
    : s,
);

/** The current stage pinned to `blocked` — the server reports the pipeline
 *  stuck here; the stage is inert (amber node + label, no Advance). */
const LIFECYCLE_BLOCKED_STAGE: Stage[] = INITIAL_LIFECYCLE.map((s) =>
  s.key === "assess" ? { ...s, state: "blocked" as const } : s,
);

/** Every stage pinned to `reverted` — a rolled-back change reads as reverted,
 *  not as an un-started stepper (all `upcoming`). */
const LIFECYCLE_REVERTED: Stage[] = INITIAL_LIFECYCLE.map((s) => ({
  ...s,
  state: "reverted" as const,
}));

export function Gallery() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<Stage[]>(INITIAL_LIFECYCLE);

  const currentStage = lifecycle.find((s) => s.key === CURRENT_STAGE_KEY);
  // Mirrors what a route handler computes server-side: every gate on the
  // current stage checked. The stepper takes this verbatim.
  const canAdvance = currentStage?.gate.every((g) => g.done) ?? false;

  const onToggleGate = (stageKey: string, gateKey: string, done: boolean) => {
    setLifecycle((prev) =>
      prev.map((s) =>
        s.key === stageKey
          ? {
              ...s,
              gate: s.gate.map((g) => (g.key === gateKey ? { ...g, done } : g)),
            }
          : s,
      ),
    );
  };

  return (
    <ThemeProvider>
      <ToastProvider>
        <div style={wrap}>
          <header style={header}>
            <div>
              <h1>Keel component gallery</h1>
              <p style={{ color: "var(--text-2)", margin: "4px 0 0" }}>
                Dev-only. Every design-system component with representative
                props, in the live theme.
              </p>
            </div>
            <ThemeToggle />
          </header>

          <Section title="AppShell">
            <p style={captionStyle}>
              Full-height grid — constrained to 520px here so it does not blow
              out the page.
            </p>
            <div style={shellFrame}>
              <AppShell
                nav={NAV}
                currentKey="changes"
                user={{ name: "Kai Rivera", sub: "technical lead" }}
                topbar={<span style={{ fontWeight: 700 }}>Changes</span>}
              >
                <div style={grid}>
                  <Panel title="My approvals" count={2}>
                    <p>Placeholder stage content.</p>
                  </Panel>
                  <Panel title="Open changes" count={7}>
                    <p>Placeholder stage content.</p>
                  </Panel>
                </div>
              </AppShell>
            </div>
          </Section>

          <Section title="Drawer">
            <button
              type="button"
              style={button}
              onClick={() => setDrawerOpen(true)}
            >
              Open drawer
            </button>
            <Drawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              title="Migrate auth to mTLS"
              idLabel="CHG-0042"
            >
              <p style={{ margin: "0 0 12px" }}>
                Sample drawer body. Radix supplies the focus trap,
                Escape-to-close, and scrim-click-to-close.
              </p>
              <p style={{ margin: 0, color: "var(--text-2)" }}>
                Owner: Kai Rivera · Risk: HIGH
              </p>
            </Drawer>
          </Section>

          <Section title="Toasts">
            <button
              type="button"
              style={button}
              onClick={() => toast("Saved.")}
            >
              Trigger a toast
            </button>
          </Section>

          <Section title="Tile">
            <div style={grid}>
              <Tile
                label="Open changes"
                value="12"
                sub="3 awaiting approval"
                tone="info"
              />
              <Tile
                label="Overdue incidents"
                value="2"
                sub="SLA breached"
                tone="crit"
              />
              <Tile
                label="Change success rate"
                value={
                  <>
                    98<small>%</small>
                  </>
                }
                sub="last 30 days"
                tone="ok"
              />
              <Tile
                label="Pending demands"
                value="7"
                sub="2 need scoring"
                tone="warn"
              />
            </div>
          </Section>

          <Section title="Panel">
            <div style={grid}>
              <Panel title="Recent activity" count={4}>
                <p>Tight 6px body padding — for list content.</p>
              </Panel>
              <Panel title="Notes" pad>
                <p>
                  Roomier 16px body via the <code>pad</code> prop.
                </p>
              </Panel>
            </div>
          </Section>

          <Section title="Pill">
            <div style={row}>
              <Pill tone="ok" dot>
                Approved
              </Pill>
              <Pill tone="warn" dot>
                At risk
              </Pill>
              <Pill tone="crit" dot>
                Blocked
              </Pill>
              <Pill tone="info" dot>
                Draft
              </Pill>
              <Pill tone="accent" dot>
                New
              </Pill>
            </div>
          </Section>

          <Section title="PriorityTag">
            <div style={row}>
              <PriorityTag priority="P1" />
              <PriorityTag priority="P2" />
              <PriorityTag priority="P3" />
              <PriorityTag priority="P4" />
            </div>
          </Section>

          <Section title="RiskLabel">
            <div style={row}>
              <RiskLabel level="LOW" />
              <RiskLabel level="MEDIUM" />
              <RiskLabel level="HIGH" />
            </div>
          </Section>

          <Section title="EnvTag">
            <div style={row}>
              <EnvTag env="dev" />
              <EnvTag env="test" />
              <EnvTag env="staging" />
              <EnvTag env="prod" />
            </div>
          </Section>

          <Section title="DataTable">
            <p style={captionStyle}>
              Interactive — <code>onRowClick</code> set. Tab to the
              visually-hidden activator button in a row&rsquo;s first cell and
              press Enter, or click anywhere on the row.
            </p>
            <DataTable
              label="Change register"
              columns={CHANGE_COLUMNS}
              rows={CHANGE_ROWS}
              getRowId={(r) => r.id}
              onRowClick={(r) => toast(`Opened ${r.id}`)}
            />

            <p style={{ ...captionStyle, marginTop: 18 }}>
              Read-only — <code>onRowClick</code> omitted. No activator, no
              affordance; the rows are inert (a pure data display).
            </p>
            <DataTable
              label="Change register (read-only)"
              columns={CHANGE_COLUMNS}
              rows={CHANGE_ROWS}
              getRowId={(r) => r.id}
            />

            <p style={{ ...captionStyle, marginTop: 18 }}>
              With an actions column — the cell&rsquo;s own button fires only
              its handler (<code>Editing …</code>), never the row&rsquo;s{" "}
              <code>onRowClick</code> (<code>Opened …</code>).
            </p>
            <DataTable
              label="Change register with actions"
              columns={CHANGE_COLUMNS_WITH_ACTIONS}
              rows={CHANGE_ROWS}
              getRowId={(r) => r.id}
              onRowClick={(r) => toast(`Opened ${r.id}`)}
            />
          </Section>

          <Section title="LifecyclePips">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <LifecyclePips stages={PIP_STAGES} currentIndex={2} />
              <LifecyclePips
                stages={PIP_STAGES}
                currentIndex={1}
                parkedIndex={3}
              />
            </div>
          </Section>

          <Section title="ActivityFeed">
            <ActivityFeed
              items={[
                {
                  id: "a1",
                  text: (
                    <>
                      Kai Rivera approved <strong>CHG-0042</strong>
                    </>
                  ),
                  meta: "2h ago · technical approval",
                  tone: "var(--ok)",
                },
                {
                  id: "a2",
                  text: "Priya N. left a comment on DEM-0075",
                  meta: "5h ago",
                  tone: "var(--accent)",
                },
                {
                  id: "a3",
                  text: "INC-0110 breached its SLA",
                  meta: "yesterday",
                  tone: "var(--crit)",
                },
                {
                  id: "a4",
                  text: "Devon L. raised DEM-0075",
                  meta: "2 days ago",
                },
              ]}
            />
          </Section>

          <Section title="Timeline">
            <Timeline
              items={[
                { time: "09:12", text: "Change created" },
                { time: "10:04", text: "Risk assessed as HIGH" },
                {
                  time: "14:20",
                  text: (
                    <>
                      Technical approval by <strong>Kai Rivera</strong>
                    </>
                  ),
                },
                { time: "16:45", text: "Scheduled for the Friday window" },
              ]}
            />
          </Section>

          <Section title="LifecycleStepper">
            <div style={twoUp}>
              <div>
                <p style={captionStyle}>
                  Interactive — current stage &ldquo;Assess&rdquo;. Advance
                  unlocks when every current-stage gate is checked.
                </p>
                <LifecycleStepper
                  stages={lifecycle}
                  currentStageKey={CURRENT_STAGE_KEY}
                  canAdvance={canAdvance}
                  onToggleGate={onToggleGate}
                  onAdvance={(from) => toast(`Advanced from ${from}`)}
                />
              </div>
              <div>
                <p style={captionStyle}>
                  Read-only — all gates inert, no Advance button.
                </p>
                <LifecycleStepper
                  stages={INITIAL_LIFECYCLE}
                  currentStageKey={CURRENT_STAGE_KEY}
                  canAdvance={false}
                  readOnly
                />
              </div>
            </div>
            <div style={{ ...twoUp, marginTop: 20 }}>
              <div>
                <p style={captionStyle}>
                  Blocked on a non-gate reason — every current-stage gate is
                  checked, but the server still returns{" "}
                  <code>canAdvance: false</code>. <code>blockedReason</code>{" "}
                  shows under the disabled Advance.
                </p>
                <LifecycleStepper
                  stages={LIFECYCLE_ASSESS_DONE}
                  currentStageKey={CURRENT_STAGE_KEY}
                  canAdvance={false}
                  blockedReason="Waiting on technical approval"
                />
              </div>
              <div>
                <p style={captionStyle}>
                  Stage pinned <code>state: &quot;blocked&quot;</code> — the
                  server reports the pipeline stuck here. Amber node + label,
                  and the stage is inert (no Advance, gates non-interactive).
                </p>
                <LifecycleStepper
                  stages={LIFECYCLE_BLOCKED_STAGE}
                  currentStageKey={CURRENT_STAGE_KEY}
                  canAdvance={false}
                />
              </div>
              <div>
                <p style={captionStyle}>
                  Rolled back — every stage carries an explicit{" "}
                  <code>state: &quot;reverted&quot;</code> that overrides the
                  derived state.
                </p>
                <LifecycleStepper
                  stages={LIFECYCLE_REVERTED}
                  currentStageKey={CURRENT_STAGE_KEY}
                  canAdvance={false}
                />
              </div>
            </div>
          </Section>
        </div>
      </ToastProvider>
    </ThemeProvider>
  );
}
