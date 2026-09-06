"use client";

// ============================================================
//  Admin: rooms, batches, people.
//
//  This is what makes the board maintainable without touching
//  code. Capacities, room names, batch names and who counts as
//  faculty all live here.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/authContext";
import { AppShell } from "@/components/AppShell";
import { useCampus } from "@/lib/campusContext";
import {
  cancelSeriesFromDate,
  createRecurringBooking,
  deleteBatch,
  deleteRoom,
  deleteUser,
  getRosterByBatch,
  setUserRole,
  setUserSubjects,
  upsertBatch,
  upsertRoom,
} from "@/lib/db";
import { DOW_LONG, fromISO, shiftDays, todayISO } from "@/lib/dates";
import { SLOTS, slotRange } from "@/lib/slots";
import { YEARS, yearLabel } from "@/lib/seedData";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import type { Batch, Booking, Role, Room, RosterEntry, UserProfile } from "@/lib/types";

type Tab = "rooms" | "batches" | "timetable" | "people";

export default function AdminPage() {
  return (
    <AppShell requireAdmin>
      <AdminBody />
    </AppShell>
  );
}

function AdminBody() {
  const [tab, setTab] = useState<Tab>("rooms");
  const tabs: { id: Tab; label: string }[] = [
    { id: "rooms", label: "Rooms" },
    { id: "batches", label: "Batches" },
    { id: "timetable", label: "Timetable" },
    { id: "people", label: "People" },
  ];

  return (
    <>
      <div className="mb-5 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={
              "border-b-2 px-3.5 pb-2.5 pt-1 text-[14px] font-medium transition-colors " +
              (tab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "rooms" ? <RoomsPanel /> : null}
      {tab === "batches" ? <BatchesPanel /> : null}
      {tab === "timetable" ? <TimetablePanel /> : null}
      {tab === "people" ? <PeoplePanel /> : null}
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
      <div className="card mb-4 p-5">
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

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
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
      <div className="card mb-4 p-5">
        <h2 className="text-[15px] font-semibold">Batches</h2>
        <button
          className="btn btn-primary mt-3.5"
          onClick={() => setDraft({ id: "", name: "", year: 1, strength: 60, extraEmails: [] })}
        >
          + Add a batch
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
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
  const [emailText, setEmailText] = useState((batch.extraEmails || []).join("\n"));
  const [confirm, setConfirm] = useState(false);
  const [showEmails, setShowEmails] = useState(false);
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

  const parsed = emailText.split(/[\s,;]+/).map((x) => x.trim()).filter((x) => x.includes("@"));
  const dirty =
    JSON.stringify({ ...d, extraEmails: parsed }) !== JSON.stringify(batch);

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
            {parsed.length ? <span className="text-muted"> · {parsed.length} extra email{parsed.length === 1 ? "" : "s"}</span> : null}
          </p>
        </div>

        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => void toggleStudents()}>
            {showStudents ? "Hide" : "Students"}
          </button>
          <button className="btn btn-sm" onClick={() => setShowEmails((s) => !s)}>
            {showEmails ? "Hide" : "Emails"}
          </button>
          <button
            className="btn btn-sm"
            disabled={!dirty}
            onClick={() => void onSave({ ...d, extraEmails: parsed })}
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

      {showEmails ? (
        <label className="mt-3 block">
          <span className="label-xs">Extra addresses copied on notices — one per line</span>
          <textarea
            className="input mt-1 min-h-[90px] resize-y font-mono text-[12px]"
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            placeholder={"student@newtonschool.co\ncoordinator@newtonschool.co"}
          />
          <span className="mt-1 block text-[12px] text-muted">
            Students who sign in are emailed automatically — you only need this list for people who have not.
          </span>
        </label>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
//  Timetable
//
//  Admin-only by construction: this whole page sits inside
//  <AppShell requireAdmin>, so a regular teacher can never reach
//  this tab even by typing the URL - firestore.rules backs that up
//  server-side too, since only an admin can cancel someone else's
//  booking. Editing a series cancels every future occurrence from
//  today and re-books it with the new day/time/room, so the change
//  is exactly one series, not a one-off exception.
// ------------------------------------------------------------
const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5]; // Mon-Fri

// Firestore has no idea of "repeat forever" - a recurring series is really
// just a batch of individual booking documents, one per week, so SOME
// horizon has to be picked when writing them. One year is long enough
// that nobody should see it run out mid-use; if a series is edited before
// then it gets pushed out another year automatically, so in practice it
// behaves like "keep going until an admin changes it," which is the
// point. (Used to be 104 weeks/2 years - dropped to keep each edit's
// write count well inside Firestore's free-plan daily quota.)
const SERIES_HORIZON_WEEKS = 52;

function nextOccurrenceOf(fromDate: string, dow: number): string {
  let d = fromDate;
  while (fromISO(d).getDay() !== dow) d = shiftDays(d, 1);
  return d;
}

/** "Pranav" -> "Pranav Sir". Leaves it alone if it already says Sir/Ma'am. */
function withHonorific(name: string): string {
  const n = (name || "").trim();
  // Skip real people who already carry a title (covers "mam" as well as
  // "ma'am"/"maam"/"madam"), skip labels that aren't a person at all
  // (e.g. "Exam Cell" for a CONTEST booking) - "Exam Cell Sir" would just
  // look wrong - and skip the shared admin account, which isn't a person.
  if (
    !n ||
    /\b(sir|ma'?am|mam|madam)\b/i.test(n) ||
    /\b(cell|committee|office|department|board)\b/i.test(n) ||
    /^admin$/i.test(n)
  ) {
    return n;
  }
  return n + " Sir";
}

/** One room's slice of a session - its own series, so its own seriesId. */
interface RoomSlot {
  seriesId: string;
  roomId: string;
  first: Booking;
}

/**
 * One row on screen. Usually backed by a single series (one room), but
 * a session that runs the same subject/teacher/time across several
 * rooms at once - an exam split across C-1, C-4, C-6, C-8, say - is
 * still, physically, several separate booking series under the hood
 * (a room-hour's conflict lock only makes sense per room). Grouping
 * them here by day+time+subject+title+teacher is what lets the admin
 * see and edit that as ONE row with several rooms ticked, instead of
 * four identical-looking rows to keep in sync by hand.
 */
interface SessionGroup {
  key: string;
  weekday: number;
  startSlot: number;
  endSlot: number;
  subject: string;
  title: string;
  facultyUid: string;
  facultyName: string;
  kind: Booking["kind"];
  batchIds: string[];
  years: number[];
  note?: string;
  rooms: RoomSlot[];
}

function TimetablePanel() {
  const campus = useCampus();
  const { bookings, rooms, roomName, batchNames, batches, users } = campus;
  const { user, profile } = useAuth();
  const { push } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A weekly series repeats every 7 days, so any 2-week forward window
  // is guaranteed to catch at least one occurrence of every active
  // series - no need to load the whole year just to build this table.
  // See setBookingsWindow's own comment for why that matters.
  useEffect(() => {
    const today = todayISO();
    campus.setBookingsWindow(today, shiftDays(today, 13));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every subject already used somewhere on the timetable - real ones
  // like "AP" or "ADA", not a generic suggestion list - so the dropdown
  // always reflects what your college actually calls its subjects.
  const subjectOptions = useMemo(
    () => Array.from(new Set(bookings.map((b) => b.subject).filter(Boolean))).sort(),
    [bookings]
  );

  // Only teachers who have actually signed in at least once - no more
  // pre-seeded names cluttering the dropdown. A row's own current
  // teacher still always shows up when editing that specific row (see
  // teacherChoices in SessionRow below), even before they've signed
  // in, so nothing looks broken - this list is just for picking a
  // DIFFERENT, real teacher.
  const teacherOptions = useMemo(() => {
    return users
      .filter((u) => u.role === "faculty" || u.role === "admin")
      .map((u) => ({ uid: u.uid, name: u.name }) as UserProfile)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const today = todayISO();
    const bySeries = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (!b.seriesId || b.status !== "confirmed" || b.date < today) continue;
      const arr = bySeries.get(b.seriesId) || [];
      arr.push(b);
      bySeries.set(b.seriesId, arr);
    }

    const groups = new Map<string, SessionGroup>();
    for (const [seriesId, occ] of bySeries) {
      occ.sort((a, b) => a.date.localeCompare(b.date));
      const first = occ[0];
      const weekday = fromISO(first.date).getDay();
      const key = [weekday, first.startSlot, first.endSlot, first.subject, first.title, first.facultyUid].join("|");
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          weekday,
          startSlot: first.startSlot,
          endSlot: first.endSlot,
          subject: first.subject,
          title: first.title,
          facultyUid: first.facultyUid,
          facultyName: first.facultyName,
          kind: first.kind,
          batchIds: first.batchIds,
          years: first.years,
          note: first.note,
          rooms: [],
        };
        groups.set(key, g);
      }
      g.rooms.push({ seriesId, roomId: first.roomId, first });
    }

    const rows = Array.from(groups.values());
    rows.sort(
      (a, b) => a.weekday - b.weekday || a.startSlot - b.startSlot || a.subject.localeCompare(b.subject)
    );
    return rows;
  }, [bookings]);

  const activeRooms = rooms.filter((r) => r.active);

  return (
    <>
      <div className="card mb-4 p-5">
        <h2 className="text-[15px] font-semibold">Weekly timetable</h2>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[860px] border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b border-line-strong bg-surface-2 text-left">
              <th className="label-xs px-3 py-2.5 font-normal">Day</th>
              <th className="label-xs px-3 py-2.5 font-normal">Time</th>
              <th className="label-xs px-3 py-2.5 font-normal">Subject</th>
              <th className="label-xs px-3 py-2.5 font-normal">Teacher</th>
              <th className="label-xs px-3 py-2.5 font-normal">Room</th>
              <th className="label-xs px-3 py-2.5 font-normal">Batches</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sessionGroups.map((group) => (
          <SessionRow
            key={group.key}
            group={group}
            rooms={activeRooms}
            roomName={roomName}
            batchNames={batchNames}
            allBatches={batches}
            teacherOptions={teacherOptions}
            subjectOptions={subjectOptions}
            editing={editingId === group.key}
            busy={busy}
            onToggleEdit={() => setEditingId(editingId === group.key ? null : group.key)}
            onSave={async (patch) => {
              if (!user || !profile) return;
              if (!patch.roomIds.length) return push("Pick at least one room.", "bad");
              setBusy(true);
              try {
                // Cancel every room this session currently uses, then book
                // the target room set fresh - simplest way to guarantee day,
                // time, subject and teacher end up identical across every
                // room, whether a room was kept, dropped, or just added.
                for (const r of group.rooms) {
                  await cancelSeriesFromDate(
                    r.seriesId,
                    todayISO(),
                    bookings,
                    roomName(r.roomId),
                    "Timetable updated by admin.",
                    user.uid,
                    profile.name
                  );
                }

                const newDate = nextOccurrenceOf(todayISO(), patch.weekday);
                const years = Array.from(
                  new Set(
                    patch.batchIds
                      .map((id) => batches.find((b) => b.id === id)?.year)
                      .filter((y): y is number => Boolean(y))
                  )
                );
                let booked = 0;
                let skipped = 0;
                for (const roomId of patch.roomIds) {
                  const result = await createRecurringBooking(
                    {
                      date: newDate,
                      roomId,
                      roomName: roomName(roomId),
                      startSlot: patch.startSlot,
                      endSlot: patch.endSlot,
                      kind: group.kind,
                      subject: patch.subject,
                      title: group.title,
                      facultyUid: patch.facultyUid,
                      facultyName: patch.facultyName,
                      years: years.length ? years : group.years,
                      batchIds: patch.batchIds,
                      note: group.note || "",
                    },
                    shiftDays(newDate, 7 * SERIES_HORIZON_WEEKS)
                  );
                  booked += result.bookedDates.length;
                  skipped += result.skipped.length;
                }

                push(
                  "Updated — " + booked + " occurrence" + (booked === 1 ? "" : "s") +
                    " booked across " + patch.roomIds.length + " room" + (patch.roomIds.length === 1 ? "" : "s") +
                    (skipped ? ", " + skipped + " skipped (already taken)" : "") + "."
                );
                setEditingId(null);
              } catch (e) {
                push(e instanceof Error ? e.message : "Could not update the series", "bad");
              } finally {
                setBusy(false);
              }
            }}
          />
            ))}
          </tbody>
        </table>
        {sessionGroups.length === 0 ? (
          <p className="p-8 text-center text-[13.5px] text-muted">
            No recurring series yet. Run <code className="font-mono">npm run seed-timetable</code>, or have
            a teacher tick &quot;repeat weekly&quot; when booking.
          </p>
        ) : null}
      </div>
    </>
  );
}

interface TimetablePatch {
  weekday: number;
  startSlot: number;
  endSlot: number;
  roomIds: string[];
  subject: string;
  facultyUid: string;
  facultyName: string;
  batchIds: string[];
}

function SessionRow({
  group,
  rooms,
  roomName,
  batchNames,
  allBatches,
  teacherOptions,
  subjectOptions,
  editing,
  busy,
  onToggleEdit,
  onSave,
}: {
  group: SessionGroup;
  rooms: Room[];
  roomName: (id: string) => string;
  batchNames: (ids: string[]) => string;
  allBatches: Batch[];
  teacherOptions: UserProfile[];
  subjectOptions: string[];
  editing: boolean;
  busy: boolean;
  onToggleEdit: () => void;
  onSave: (patch: TimetablePatch) => Promise<void>;
}) {
  const [weekday, setWeekday] = useState(group.weekday);
  const [startSlot, setStartSlot] = useState(group.startSlot);
  const [endSlot, setEndSlot] = useState(group.endSlot);
  const [roomIds, setRoomIds] = useState<string[]>(group.rooms.map((r) => r.roomId));
  const [subject, setSubject] = useState(group.subject);
  const [facultyUid, setFacultyUid] = useState(group.facultyUid);
  const [batchIds, setBatchIds] = useState<string[]>(group.batchIds);

  // The dropdown always includes whatever this session already has, even
  // if it's since fallen off the "known" list (a subject nobody else
  // uses, or a teacher who no longer has a profile) - so opening Edit
  // never silently changes something you didn't touch.
  const subjectChoices = subjectOptions.includes(subject) ? subjectOptions : [subject, ...subjectOptions];
  const teacherChoices = teacherOptions.some((t) => t.uid === facultyUid)
    ? teacherOptions
    : [{ uid: facultyUid, name: group.facultyName } as UserProfile, ...teacherOptions];

  const facultyName = teacherChoices.find((t) => t.uid === facultyUid)?.name || group.facultyName;

  return (
    <tr className={"border-b border-line last:border-b-0 " + (editing ? "bg-surface-2" : "hover:bg-surface-2/60")}>
      <td className="px-3 py-2.5 align-middle">
        {editing ? (
          <select className="input h-9 w-full" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {WEEKDAY_OPTIONS.map((d) => (
              <option key={d} value={d}>{DOW_LONG[d]}</option>
            ))}
          </select>
        ) : (
          <span className="font-medium">{DOW_LONG[group.weekday]}</span>
        )}
      </td>

      <td className="px-3 py-2.5 align-middle">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <select
              className="input h-9 w-[92px]"
              value={startSlot}
              onChange={(e) => {
                const v = Number(e.target.value);
                setStartSlot(v);
                if (v > endSlot) setEndSlot(v);
              }}
            >
              {SLOTS.map((s) => <option key={s.index} value={s.index}>{s.start}</option>)}
            </select>
            <span className="text-muted">–</span>
            <select className="input h-9 w-[92px]" value={endSlot} onChange={(e) => setEndSlot(Number(e.target.value))}>
              {SLOTS.filter((s) => s.index >= startSlot).map((s) => (
                <option key={s.index} value={s.index}>{s.end}</option>
              ))}
            </select>
          </div>
        ) : (
          <span className="font-mono text-[12.5px] tnum">{slotRange(group.startSlot, group.endSlot)}</span>
        )}
      </td>

      <td className="px-3 py-2.5 align-middle">
        {editing ? (
          <select className="input h-9 w-full" value={subject} onChange={(e) => setSubject(e.target.value)}>
            {subjectChoices.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <>
            <div className="font-medium">{group.subject}</div>
            {group.title ? <div className="text-[12px] text-muted">{group.title}</div> : null}
          </>
        )}
      </td>

      <td className="px-3 py-2.5 align-middle">
        {editing ? (
          <select className="input h-9 w-full" value={facultyUid} onChange={(e) => setFacultyUid(e.target.value)}>
            {teacherChoices.map((t) => <option key={t.uid} value={t.uid}>{withHonorific(t.name)}</option>)}
          </select>
        ) : (
          withHonorific(group.facultyName)
        )}
      </td>

      <td className="px-3 py-2.5 align-middle">
        {editing ? (
          <RoomMultiBox rooms={rooms} selected={roomIds} onChange={setRoomIds} />
        ) : (
          group.rooms.map((r) => roomName(r.roomId)).join(", ")
        )}
      </td>

      <td className="px-3 py-2.5 align-middle text-muted">
        {editing ? (
          <BatchMultiBox batches={allBatches} selected={batchIds} onChange={setBatchIds} />
        ) : (
          batchNames(group.batchIds)
        )}
      </td>

      <td className="px-3 py-2.5 text-right align-middle">
        {editing ? (
          <div className="flex justify-end gap-1.5">
            <button className="btn btn-sm" onClick={onToggleEdit}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !batchIds.length || !roomIds.length}
              onClick={() =>
                void onSave({ weekday, startSlot, endSlot, roomIds, subject, facultyUid, facultyName, batchIds })
              }
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <button className="btn btn-sm" onClick={onToggleEdit}>Edit</button>
        )}
      </td>
    </tr>
  );
}

/**
 * Same idea as BatchMultiBox, for rooms - this is exactly what a
 * multi-room exam ("CONTEST" across C-1/C-4/C-6/C-8, say) needs: pick
 * every room this one session actually uses, in one box, instead of
 * one identical-looking timetable row per room.
 */
function RoomMultiBox({
  rooms,
  selected,
  onChange,
}: {
  rooms: Room[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = selected.length
    ? rooms.filter((r) => selected.includes(r.id)).map((r) => r.name).join(", ")
    : "Select rooms";

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="relative">
      <button type="button" className="input h-9 w-full truncate text-left" onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-[240px] w-max min-w-full overflow-y-auto rounded-lg border border-line-strong bg-surface p-1.5 shadow-lg">
            {rooms.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface-2"
              >
                <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                {r.name}
              </label>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A batch can have more than one group in it (a shared lecture, say),
 * so this can't be a plain single-value dropdown - but it still needed
 * to look and behave like the boxed dropdowns next to it rather than a
 * native multi-select (which needs ctrl/cmd-click and confuses almost
 * everyone). Click the box, tick whichever batches apply, click away
 * to close.
 */
function BatchMultiBox({
  batches,
  selected,
  onChange,
}: {
  batches: Batch[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = selected.length
    ? batches.filter((b) => selected.includes(b.id)).map((b) => b.name).join(", ")
    : "Select batches";

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="input h-9 w-full truncate text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-[240px] w-max min-w-full overflow-y-auto rounded-lg border border-line-strong bg-surface p-1.5 shadow-lg">
            {YEARS.map((y) => {
              const forYear = batches.filter((b) => b.year === y);
              if (!forYear.length) return null;
              return (
                <div key={y} className="mb-1 last:mb-0">
                  <div className="label-xs px-1.5 py-1">{yearLabel(y)}</div>
                  {forYear.map((b) => (
                    <label
                      key={b.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface-2"
                    >
                      <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} />
                      {b.name}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
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
      <div className="card mb-4 p-5">
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="label-xs mb-2">{title}</h3>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">{children}</div>
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
