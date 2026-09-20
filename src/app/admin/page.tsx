"use client";

// ============================================================
//  Admin: rooms, batches, people.
//
//  This is what makes the board maintainable without touching
//  code. Capacities, room names, batch names and who counts as
//  faculty all live here.
// ============================================================

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import {
  approveBooking,
  cancelBooking,
  deleteBatch,
  deleteRoom,
  deleteUser,
  getRosterByBatch,
  setUserRole,
  setUserSubjects,
  upsertBatch,
  upsertRoom,
} from "@/lib/db";
import { usePendingApprovals } from "@/lib/usePendingApprovals";
import { clockTime, prettyDate } from "@/lib/dates";
import { slotRange } from "@/lib/slots";
import { withHonorific } from "@/lib/people";
import { YEARS, yearLabel } from "@/lib/seedData";
import { useToast } from "@/components/Toast";
import { SegTabs } from "@/components/PageHeader";
import { useManualSync } from "@/lib/timetable/useTimetableSync";
import { SHEETS } from "@/lib/timetable/config";
import { Modal } from "@/components/Modal";
import type { Batch, Role, Room, RosterEntry, UserProfile } from "@/lib/types";

type Tab = "rooms" | "batches" | "people" | "approvals" | "timetable";

export default function AdminPage() {
  return (
    <AppShell requireAdmin>
      <AdminBody />
    </AppShell>
  );
}

function AdminBody() {
  const [tab, setTab] = useState<Tab>("rooms");
  const { pending } = usePendingApprovals();
  const tabs: { id: Tab; label: string }[] = [
    { id: "rooms", label: "Rooms" },
    { id: "batches", label: "Batches" },
    { id: "people", label: "People" },
    { id: "approvals", label: "Approvals" },
    { id: "timetable", label: "Timetable" },
  ];

  return (
    <>
      <div className="mb-5">
        <SegTabs tabs={tabs.map((t) => ({ ...t, badge: t.id === "approvals" ? pending.length : undefined }))} value={tab} onChange={setTab} />
      </div>

      {tab === "rooms" ? <RoomsPanel /> : null}
      {tab === "batches" ? <BatchesPanel /> : null}
      {tab === "people" ? <PeoplePanel /> : null}
      {tab === "approvals" ? <ApprovalsPanel /> : null}
      {tab === "timetable" ? <TimetablePanel /> : null}
    </>
  );
}

// ------------------------------------------------------------
//  Rooms
// ------------------------------------------------------------
function RoomsPanel() {
  const { rooms } = useCampus();
  const { push } = useToast();
  const [draft, setDraft] = useState<Room | null>(null);

  async function save(r: Room) {
    if (!r.id.trim() || !r.name.trim()) return push("A room needs an id and a name", "bad");
    if (!Number.isFinite(r.capacity) || r.capacity < 1) return push("Capacity must be a positive number", "bad");
    await upsertRoom({ ...r, id: r.id.trim(), name: r.name.trim(), note: r.note.trim() });
    push("Saved " + r.name);
    setDraft(null);
  }

  return (
    <>
      <div className="card card-pad mb-4">
        <h2 className="text-[15px] font-semibold">Rooms and capacities</h2>
        <button
          className="btn btn-primary mt-3.5"
          onClick={() =>
            setDraft({
              id: "",
              name: "",
              note: "",
              capacity: 60,
              order: rooms.length + 1,
              active: true,
            })
          }
        >
          + Add a room
        </button>
      </div>

      <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow)]">
        {rooms.map((r) => (
          <RoomRow
            key={r.id}
            room={r}
            onSave={save}
            onDelete={async () => {
              try {
                await deleteRoom(r.id);
                push("Deleted " + r.name);
              } catch (e) {
                push(e instanceof Error ? "Could not delete: " + e.message : "Could not delete that room.", "bad");
              }
            }}
          />
        ))}
        {rooms.length === 0 ? (
          <p className="p-8 text-center text-[13.5px] text-muted">
            No rooms yet. Run <code className="font-mono">npm run seed</code> to load the campus list,
            or add them here.
          </p>
        ) : null}
      </div>

      {draft ? (
        <Modal
          title="New room"
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save(draft)}>Add room</button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label-xs">Id (no spaces)</span>
              <input
                className="input mt-1"
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                placeholder="c9"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="label-xs">Name</span>
              <input className="input mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="C-9" />
            </label>
            <label className="block">
              <span className="label-xs">Note</span>
              <input className="input mt-1" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="optional" />
            </label>
            <label className="block">
              <span className="label-xs">Capacity</span>
              <input
                className="input mt-1"
                type="number"
                min={1}
                value={draft.capacity}
                onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })}
              />
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function RoomRow({
  room,
  onSave,
  onDelete,
}: {
  room: Room;
  onSave: (r: Room) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [d, setD] = useState(room);
  const [confirm, setConfirm] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(room);

  return (
    <div className="grid grid-cols-1 items-end gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[80px_1fr_1fr_96px_88px_auto]">
      <div className="font-mono text-[11.5px] text-muted">{room.id}</div>

      <label className="block">
        <span className="label-xs">Name</span>
        <input className="input mt-1" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>

      <label className="block">
        <span className="label-xs">Note</span>
        <input className="input mt-1" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="—" />
      </label>

      <label className="block">
        <span className="label-xs">Capacity</span>
        <input
          className="input mt-1 tnum"
          type="number"
          min={1}
          value={d.capacity}
          onChange={(e) => setD({ ...d, capacity: Number(e.target.value) })}
        />
      </label>

      <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-[13px]">
        <input type="checkbox" className="accent-[var(--accent)]" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
        On board
      </label>

      <div className="flex gap-2">
        <button className="btn btn-sm" disabled={!dirty} onClick={() => void onSave(d)}>
          {dirty ? "Save" : "Saved"}
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => {
            if (!confirm) return setConfirm(true);
            void onDelete();
          }}
          onBlur={() => setConfirm(false)}
        >
          {confirm ? "Sure?" : "Delete"}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
//  Batches
// ------------------------------------------------------------
function BatchesPanel() {
  const { batches, users } = useCampus();
  const { push } = useToast();
  const [draft, setDraft] = useState<Batch | null>(null);

  async function save(b: Batch) {
    if (!b.id.trim() || !b.name.trim()) return push("A batch needs an id and a name", "bad");
    await upsertBatch({ ...b, id: b.id.trim(), name: b.name.trim() });
    push("Saved " + b.name);
    setDraft(null);
  }

  return (
    <>
      <div className="card card-pad mb-4">
        <h2 className="text-[15px] font-semibold">Batches</h2>
        <button
          className="btn btn-primary mt-3.5"
          onClick={() => setDraft({ id: "", name: "", year: 1, strength: 60, extraEmails: [] })}
        >
          + Add a batch
        </button>
      </div>

      <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow)]">
        {batches.map((b) => (
          <BatchRow
            key={b.id}
            batch={b}
            signedInCount={users.filter((u) => u.role === "student" && u.batchId === b.id).length}
            onSave={save}
            onDelete={async () => {
              await deleteBatch(b.id);
              push("Deleted " + b.name);
            }}
          />
        ))}
        {batches.length === 0 ? (
          <p className="p-8 text-center text-[13.5px] text-muted">No batches yet.</p>
        ) : null}
      </div>

      {draft ? (
        <Modal
          title="New batch"
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save(draft)}>Add batch</button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label-xs">Id (no spaces)</span>
              <input
                className="input mt-1"
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                placeholder="y2-d"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="label-xs">Name</span>
              <input className="input mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="2nd Year - D" />
            </label>
            <label className="block">
              <span className="label-xs">Year</span>
              <select className="input mt-1" value={draft.year} onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })}>
                {YEARS.map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-xs">Strength</span>
              <input className="input mt-1" type="number" min={1} value={draft.strength} onChange={(e) => setDraft({ ...draft, strength: Number(e.target.value) })} />
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function BatchRow({
  batch,
  signedInCount,
  onSave,
  onDelete,
}: {
  batch: Batch;
  signedInCount: number;
  onSave: (b: Batch) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [d, setD] = useState(batch);
  // Kept, not shown: these addresses were only ever used to copy people
  // on the notice emails, and nothing mails anybody now. Carried through
  // a save so an old list is preserved rather than quietly wiped.
  const keptEmails = batch.extraEmails || [];
  const [confirm, setConfirm] = useState(false);
  const [showStudents, setShowStudents] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterErr, setRosterErr] = useState<string | null>(null);

  async function toggleStudents() {
    if (showStudents) return setShowStudents(false);
    setShowStudents(true);
    if (roster) return; // already loaded once - names don't change on their own
    setRosterBusy(true);
    setRosterErr(null);
    try {
      setRoster(await getRosterByBatch(batch.id));
    } catch (e) {
      setRosterErr(e instanceof Error ? e.message : "Could not load students.");
    } finally {
      setRosterBusy(false);
    }
  }

  const dirty =
    JSON.stringify({ ...d, extraEmails: keptEmails }) !== JSON.stringify(batch);

  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[80px_1fr_120px_96px_1fr_auto]">
        <div className="font-mono text-[11.5px] text-muted">{batch.id}</div>

        <label className="block">
          <span className="label-xs">Name</span>
          <input className="input mt-1" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>

        <label className="block">
          <span className="label-xs">Year</span>
          <select className="input mt-1" value={d.year} onChange={(e) => setD({ ...d, year: Number(e.target.value) })}>
            {YEARS.map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="label-xs">Strength</span>
          <input className="input mt-1 tnum" type="number" min={1} value={d.strength} onChange={(e) => setD({ ...d, strength: Number(e.target.value) })} />
        </label>

        <div>
          <span className="label-xs">Signed in</span>
          <p className="mt-1 text-[13px] tnum">
            {signedInCount} student{signedInCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => void toggleStudents()}>
            {showStudents ? "Hide" : "Students"}
          </button>
          <button
            className="btn btn-sm"
            disabled={!dirty}
            onClick={() => void onSave({ ...d, extraEmails: keptEmails })}
          >
            {dirty ? "Save" : "Saved"}
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => {
              if (!confirm) return setConfirm(true);
              void onDelete();
            }}
          >
            {confirm ? "Sure?" : "Delete"}
          </button>
        </div>
      </div>

      {showStudents ? (
        <div className="mt-3">
          <span className="label-xs">Students in {batch.name}</span>
          {rosterBusy ? (
            <p className="mt-1.5 text-[13px] text-muted">Loading…</p>
          ) : rosterErr ? (
            <p className="mt-1.5 text-[13px] text-busy">{rosterErr}</p>
          ) : roster && roster.length ? (
            <div className="mt-1.5 max-h-[280px] overflow-y-auto rounded border border-line">
              <table className="w-full text-[12.5px]">
                <tbody>
                  {roster.map((r) => (
                    <tr key={r.email} className="border-b border-line last:border-b-0">
                      <td className="px-2.5 py-1.5 font-medium">{r.name || <span className="text-muted">(no name yet)</span>}</td>
                      <td className="px-2.5 py-1.5 font-mono text-[11.5px] text-muted">{r.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-1.5 text-[13px] text-muted">
              No roster loaded for this batch yet — run <code className="font-mono">npm run seed-roster</code> after
              adding names for it, or these students just haven&apos;t been given roster rows yet.
            </p>
          )}
        </div>
      ) : null}

    </div>
  );
}

// ------------------------------------------------------------
//  (The old Timetable admin tab lived here - removed. Recurring
//  weekly sessions are still created the normal way, by a teacher
//  ticking "repeat weekly" when booking a slot on the board.)
// ------------------------------------------------------------

// ------------------------------------------------------------
//  Approvals
//
//  Every teacher's booking that still needs signing off, campus-wide
//  and in date order, so an admin can clear the lot from one screen
//  instead of hunting for dashed boxes across the board.
// ------------------------------------------------------------
function ApprovalsPanel() {
  const { pending, error } = usePendingApprovals();
  const { roomName, batchNames } = useCampus();
  const { profile } = useAuth();
  const { push } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(bookingId: string, approve: boolean) {
    const booking = pending.find((b) => b.id === bookingId);
    if (!booking || !profile) return;

    setBusyId(bookingId);
    try {
      if (approve) {
        await approveBooking(booking, roomName(booking.roomId), profile.uid, profile.name);
        push("Approved — " + booking.subject + " is confirmed");
      } else {
        // Turning one down frees the room and posts a cancellation
        // notice, which is exactly what a rejection means here.
        await cancelBooking(
          booking,
          roomName(booking.roomId),
          "Not approved",
          profile.uid,
          profile.name
        );
        push("Turned down — " + roomName(booking.roomId) + " is free again");
      }
    } catch (e) {
      push(e instanceof Error ? e.message : "Could not save that.", "bad");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="card card-pad mb-4">
        <h2 className="text-[15px] font-semibold">Waiting for approval</h2>
        <p className="mt-1.5 text-[13px] text-muted">
          Rooms below are already held for these hours, so nobody can take them while you decide.
          Approving confirms the session; turning it down frees the room straight away.
        </p>
      </div>

      {error ? (
        <div className="card mb-4 border-busy-line bg-busy-soft p-4 text-[13px]">{error}</div>
      ) : null}

      {pending.length === 0 ? (
        <div className="card p-6 text-center text-[13.5px] text-muted">
          Nothing waiting — every booking is signed off.
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {pending.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-[220px] flex-1">
                <div className="text-[14px] font-semibold [overflow-wrap:anywhere]">
                  {b.subject}
                  {b.title ? <span className="font-normal text-ink-2"> — {b.title}</span> : null}
                </div>
                <div className="mt-0.5 text-[12.5px] text-muted">
                  {roomName(b.roomId)} · {prettyDate(b.date)} · {slotRange(b.startSlot, b.endSlot)}
                </div>
                <div className="mt-0.5 text-[12px] text-muted [overflow-wrap:anywhere]">
                  {withHonorific(b.facultyName)}
                  {b.batchIds.length ? " · " + batchNames(b.batchIds) : ""}
                  {b.seriesId ? " · weekly series" : ""}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="btn btn-sm"
                  disabled={busyId === b.id}
                  onClick={() => void decide(b.id, false)}
                >
                  Turn down
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busyId === b.id}
                  onClick={() => void decide(b.id, true)}
                >
                  {busyId === b.id ? "Working…" : "Approve"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------
//  People
// ------------------------------------------------------------
function PeoplePanel() {
  const { users, batches } = useCampus();
  const { push } = useToast();
  const [q, setQ] = useState("");

  const filtered = users.filter(
    (u) =>
      !q.trim() ||
      u.name.toLowerCase().includes(q.toLowerCase()) ||
      u.email.toLowerCase().includes(q.toLowerCase())
  );

  const faculty = filtered.filter((u) => u.role === "faculty" || u.role === "admin");
  const students = filtered.filter((u) => u.role === "student");

  return (
    <>
      <div className="card card-pad mb-4">
        <h2 className="text-[15px] font-semibold">People</h2>
        <input
          className="input mt-3.5 max-w-[320px]"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email"
        />
      </div>

      <Section title={"Faculty and admins (" + faculty.length + ")"}>
        {faculty.map((u) => <PersonRow key={u.uid} user={u} onToast={push} />)}
        {faculty.length === 0 ? <Empty>Nobody yet.</Empty> : null}
      </Section>

      <Section title={"Students (" + students.length + ")"}>
        {students.map((u) => (
          <PersonRow
            key={u.uid}
            user={u}
            batchName={u.batchId ? batches.find((b) => b.id === u.batchId)?.name : undefined}
            onToast={push}
          />
        ))}
        {students.length === 0 ? <Empty>No students have signed in yet.</Empty> : null}
      </Section>
    </>
  );
}


// ============================================================
//  Admin -> Timetable
//
//  The timetable is not edited here, and deliberately so: it is
//  edited in the two Google Sheets, and this site follows them.
//  What this panel is for is seeing that the following is
//  actually working - when it last looked, what it changed, and
//  anything on the sheets it could not place.
// ============================================================

function TimetablePanel() {
  const { run, busy, report, error } = useManualSync();

  return (
    <>
      <Section title="Where the timetable comes from">
        <div className="border-b border-line px-4 py-4 last:border-b-0">
          <p className="text-[13.5px] text-muted">
            The board follows these two Google Sheets. Edit a sheet and the change reaches
            the board on its own, usually within ten minutes — there is nothing to re-run
            and nothing to copy across. Sessions that came from a sheet cannot be edited
            here, because the next check would only put them back.
          </p>
          <ul className="mt-3 space-y-1.5">
            {SHEETS.map((sheet) => (
              <li key={sheet.id} className="text-[13px]">
                <span className="font-semibold">{sheet.label}</span>{" "}
                <a
                  className="text-accent underline underline-offset-2"
                  href={"https://docs.google.com/spreadsheets/d/" + sheet.id + "/edit"}
                  target="_blank"
                  rel="noreferrer"
                >
                  open the sheet
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Sync">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 last:border-b-0">
          <button className="btn btn-primary" onClick={() => void run()} disabled={busy}>
            {busy ? "Reading the sheets…" : "Sync now"}
          </button>
          <span className="text-[13px] text-muted">
            {busy
              ? "This can take a moment the first time."
              : "Checks both sheets straight away, without waiting for the usual ten minutes."}
          </span>
        </div>

        {error ? (
          <div className="border-b border-line bg-busy-soft px-4 py-3 text-[13.5px] text-ink-2 last:border-b-0">
            {error}
          </div>
        ) : null}

        {report ? (
          <div className="border-b border-line px-4 py-4 last:border-b-0">
            <p className="text-[13.5px]">
              <span className="font-semibold">{outcomeLabel(report.outcome)}</span>{" "}
              <span className="text-muted">at {clockTime(report.checkedAt)}</span>
            </p>
            <p className="mt-1.5 text-[13px] text-muted">
              {report.sessionsFound} sessions read from the sheets · {report.created} added ·{" "}
              {report.updated} changed · {report.removed} removed · booked through{" "}
              {prettyDate(report.to)}
            </p>

            {report.displaced.length ? (
              <div className="mt-3">
                <h4 className="label-xs mb-1.5">Cancelled to make room for the timetable</h4>
                <ul className="space-y-1">
                  {report.displaced.map((d) => (
                    <li key={d} className="text-[12.5px] text-muted">{d}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[12.5px] text-muted">
                  These were teachers&rsquo; own bookings in a room the sheet needs at that
                  hour. They are cancelled rather than deleted, so each one still shows on the
                  board with its reason and can be reinstated elsewhere.
                </p>
              </div>
            ) : null}

            {report.problems.length ? (
              <div className="mt-3">
                <h4 className="label-xs mb-1.5">Rows on the sheets that could not be placed</h4>
                <ul className="space-y-1">
                  {report.problems.map((p) => (
                    <li key={p} className="text-[12.5px] text-muted">{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <Empty>Press “Sync now” to check the sheets and see what changed.</Empty>
        )}
      </Section>
    </>
  );
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "synced": return "The board was brought in line with the sheets";
    case "unchanged": return "The sheets have not changed";
    case "fresh": return "Already checked in the last few minutes";
    default: return "The sync could not finish";
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="label-xs mb-2">{title}</h3>
      <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow)]">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-[13.5px] text-muted">{children}</p>;
}

function PersonRow({
  user,
  batchName,
  onToast,
}: {
  user: UserProfile;
  batchName?: string;
  onToast: (t: string, tone?: "ok" | "bad" | "info") => void;
}) {
  const [subjects, setSubjects] = useState((user.subjects || []).join(", "));
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="grid grid-cols-1 items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_180px_150px_auto_auto]">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{user.name}</div>
        <div className="font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">{user.email}</div>
      </div>

      <div className="text-[12.5px] text-muted">
        {user.role === "student"
          ? batchName || user.batchId || "no batch"
          : editing
            ? null
            : (user.subjects || []).join(" · ") || "no subjects set"}
        {editing ? (
          <input
            className="input"
            value={subjects}
            onChange={(e) => setSubjects(e.target.value)}
            placeholder="Robotics, AR/VR"
          />
        ) : null}
      </div>

      <select
        className="input"
        value={user.role}
        aria-label={"Role for " + user.name}
        onChange={(e) => {
          const role = e.target.value as Role;
          void setUserRole(user.uid, role).then(
            () => onToast(user.name + " is now " + role),
            (err: Error) => onToast("Could not change role: " + err.message, "bad")
          );
        }}
      >
        <option value="student">Student</option>
        <option value="faculty">Faculty</option>
        <option value="admin">Admin</option>
      </select>

      {user.role !== "student" ? (
        <button
          className="btn btn-sm"
          onClick={() => {
            if (!editing) return setEditing(true);
            const list = subjects.split(",").map((s) => s.trim()).filter(Boolean);
            void setUserSubjects(user.uid, list, user.years || []).then(
              () => {
                onToast("Subjects updated for " + user.name);
                setEditing(false);
              },
              (err: Error) => onToast("Could not save: " + err.message, "bad")
            );
          }}
        >
          {editing ? "Save subjects" : "Edit subjects"}
        </button>
      ) : (
        <span />
      )}

      <button
        className="btn btn-sm btn-danger"
        onClick={() => {
          if (!confirm) return setConfirm(true);
          void deleteUser(user.uid).then(
            () => onToast("Removed " + user.name),
            (err: Error) => onToast("Could not remove: " + err.message, "bad")
          );
        }}
        onBlur={() => setConfirm(false)}
      >
        {confirm ? "Sure?" : "Remove"}
      </button>
    </div>
  );
}
