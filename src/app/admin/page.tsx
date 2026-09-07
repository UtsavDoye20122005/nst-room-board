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
import { useCampus } from "@/lib/campusContext";
import {
  deleteBatch,
  deleteRoom,
  deleteUser,
  getRosterByBatch,
  setUserRole,
  setUserSubjects,
  upsertBatch,
  upsertRoom,
} from "@/lib/db";
import { YEARS, yearLabel } from "@/lib/seedData";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import type { Batch, Role, Room, RosterEntry, UserProfile } from "@/lib/types";

type Tab = "rooms" | "batches" | "people";

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
//  (The old Timetable admin tab lived here - removed. Recurring
//  weekly sessions are still created the normal way, by a teacher
//  ticking "repeat weekly" when booking a slot on the board.)
// ------------------------------------------------------------

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
