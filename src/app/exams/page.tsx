"use client";

// ============================================================
//  Admin: exam days, invigilator duty and the teacher log.
//
//  An exam day is a date, a time, and the rooms being used with
//  how many invigilators each one needs. Press Assign and the
//  duties are drawn - fairly random, and never clashing with a
//  teacher's own class, because Room Board already knows the
//  bookings for that hour.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import { prettyDate, shiftDays, todayISO } from "@/lib/dates";
import { SLOTS, slotRange } from "@/lib/slots";
import { attendanceSheet, dutyLogSheet } from "@/lib/invigPdf";
import { downloadPdf } from "@/lib/minipdf";
import {
  addDuty,
  busyEmailsOn,
  cleanEmail,
  decideSkip,
  decideSwapIn,
  deleteExamDay,
  deleteInvigilator,
  importFaculty,
  makeRng,
  markAttendance,
  moveDuty,
  planAssignments,
  removeDuty,
  roomPlansFrom,
  unlockPartner,
  saveExamDay,
  setInvigilatorActive,
  subscribeAllDuties,
  subscribeDutiesOn,
  subscribeExamDays,
  subscribeInvigilators,
  subscribeLog,
  suggestNeeded,
  upsertInvigilator,
  writeAssignments,
  tallyDuties,
  EMPTY_TALLY,
  type PoolMember,
  type Tally,
} from "@/lib/invigilation";
import { seatingLink } from "@/lib/links";
import type { Duty, ExamDay, ExamRoomPlan, Invigilator } from "@/lib/types";

type Tab = "days" | "teachers" | "log";

export default function ExamsPage() {
  return (
    <AppShell requireAdmin>
      <ExamsBody />
    </AppShell>
  );
}

function ExamsBody() {
  const [tab, setTab] = useState<Tab>("days");
  const tabs: { id: Tab; label: string }[] = [
    { id: "days", label: "Exam days" },
    { id: "teachers", label: "Teachers" },
    { id: "log", label: "Log" },
  ];

  return (
    <>
      <div className="mb-5 flex items-center gap-1 border-b border-line">
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
        <a
          href={seatingLink()}
          target="_blank"
          rel="noopener noreferrer"
          className="border-b-2 border-transparent px-3.5 pb-2.5 pt-1 text-[14px] font-medium text-muted transition-colors hover:text-ink"
        >
          Seating chart ↗
        </a>
      </div>

      {tab === "days" ? <DaysPanel /> : null}
      {tab === "teachers" ? <TeachersPanel /> : null}
      {tab === "log" ? <LogPanel /> : null}
    </>
  );
}

// ------------------------------------------------------------
//  Exam days
// ------------------------------------------------------------

/**
 * Every write on this page goes through here. Without it a refused
 * write just makes the button appear to do nothing: the screen is
 * driven by a live subscription, so it simply snaps back to what the
 * database still says, with no hint that anything was rejected.
 */
function useRun() {
  const { push } = useToast();
  return (p: Promise<unknown>, ok?: string) => {
    p.then(
      () => {
        if (ok) push(ok);
      },
      (e: Error) => push(e?.message || "That did not go through.", "bad")
    );
  };
}

function DaysPanel() {
  const { push } = useToast();
  const { profile } = useAuth();
  const campus = useCampus();
  const [days, setDays] = useState<ExamDay[]>([]);
  const [invigilators, setInvigilators] = useState<Invigilator[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [allDuties, setAllDuties] = useState<Duty[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [editing, setEditing] = useState<ExamDay | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => subscribeExamDays(setDays, (e) => push(e.message, "bad")), [push]);
  useEffect(() => subscribeInvigilators(setInvigilators, (e) => push(e.message, "bad")), [push]);
  useEffect(() => subscribeAllDuties(setAllDuties, (e) => push(e.message, "bad")), [push]);

  // days arrive newest-first. With nothing chosen, open the exam that
  // is actually next - today's or the soonest ahead - and only fall
  // back to the most recent past one when there is nothing ahead.
  const today = todayISO();
  const nearest = [...days].reverse().find((d) => d.date >= today) || days[0] || null;
  const selected = days.find((d) => d.id === selectedId) || nearest;

  useEffect(() => {
    if (!selected) return;
    campus.setBookingsWindow(selected.date, selected.date);
    return subscribeDutiesOn(selected.date, setDuties, (e) => push(e.message, "bad"));
  }, [selected?.date, push]); // eslint-disable-line react-hooks/exhaustive-deps

  const by = { email: profile?.email || "", name: profile?.name || "Admin" };

  const run = useRun();

  const busy = useMemo(() => {
    if (!selected) return new Set<string>();
    return busyEmailsOn(selected, campus.bookings, campus.users);
  }, [selected, campus.bookings, campus.users]);

  // The timetable is fetched a day at a time. Straight after switching
  // exam day it still holds the PREVIOUS day's classes, and every one
  // of those is filtered out by date - so the clash check would pass
  // everybody. Anything left over from another date means not yet.
  const bookingsReady =
    !!selected && campus.users.length > 0 && campus.bookings.every((b) => b.date === selected.date);

  // How many duties each teacher has done, counted from the duty
  // records themselves so the number can never drift.
  const tally = useMemo(() => tallyDuties(allDuties), [allDuties]);

  // Counts for the draw ignore this day's own duties. Redrawing must
  // not punish the people who happen to be holding the duties that are
  // about to be deleted, or "Draw again" just rotates everybody off.
  const tallyForDraw = useMemo(
    () => tallyDuties(selected ? allDuties.filter((d) => d.date !== selected.date) : allDuties),
    [allDuties, selected]
  );

  const pool: PoolMember[] = useMemo(
    () =>
      invigilators
        .filter((i) => i.active !== false && !busy.has(cleanEmail(i.email)))
        .map((i) => ({ email: i.email, name: i.name, duties: (tallyForDraw.get(i.email) || EMPTY_TALLY).duties })),
    [invigilators, busy, tallyForDraw]
  );

  async function assign() {
    if (!selected) return;
    const needed = selected.rooms.filter((r) => r.used !== false).reduce((n, r) => n + r.needed, 0);
    if (!bookingsReady) {
      push("Still reading the timetable for that day. Try again in a second.", "bad");
      return;
    }
    if (!pool.length) {
      push("No teacher is free for that time. Add teachers first.", "bad");
      return;
    }
    // Drawing again throws away everything on this day, including
    // anything already recorded. Say so before it happens.
    const marked = duties.filter((d) => d.present != null).length;
    const pairs = duties.filter((d) => d.partnerLocked).length;
    if (duties.length) {
      const losing = [
        duties.length + (duties.length === 1 ? " duty" : " duties"),
        pairs ? pairs / 2 + " agreed pair(s)" : "",
        marked ? marked + " attendance mark(s)" : "",
      ].filter(Boolean);
      if (!window.confirm("Draw again? This replaces " + losing.join(", ") + " for " + prettyDate(selected.date) + ".")) {
        return;
      }
    }
    const plan = planAssignments({
      rooms: selected.rooms,
      pool,
      reserveCount: selected.reserveCount ?? 2,
      rng: makeRng(Date.now() >>> 0),
    });
    try {
      await writeAssignments(selected, plan, by);
      push(
        plan.short
          ? plan.picks.length + " of " + needed + " seats filled. " + plan.short + " could not be: not enough free teachers."
          : needed + " duties given out, plus " + plan.reserves.length + " on standby.",
        plan.short ? "info" : "ok"
      );
    } catch (e) {
      push((e as Error).message, "bad");
    }
  }

  const skipRequests = duties.filter((d) => d.status === "skip-requested");
  const swapRequests = duties.filter((d) => !!d.swapWantEmail);
  // Somebody drawn as standby who has since been put in a room is not
  // standby any more, whatever the exam day still says.
  const standby = (selected?.reserves || []).filter(
    (e) => !duties.some((d) => d.email === e && d.status !== "skipped")
  );
  const namesByEmail = new Map(invigilators.map((i) => [i.email, i.name]));
  // A teacher waiting on the office to approve their drop still holds
  // the duty, and the room cards and the PDF both count them, so this
  // has to as well or the header contradicts the page under it.
  const assigned = duties.filter((d) => d.status !== "skipped");
  const onDutyEmails = new Set(assigned.map((d) => d.email));
  const neededTotal = selected ? selected.rooms.filter((r) => r.used !== false).reduce((n, r) => n + r.needed, 0) : 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <aside className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="label-xs">Exam days</span>
          <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
            New
          </button>
        </div>
        {days.length === 0 ? (
          <p className="px-1 py-3 text-[13px] text-muted">
            No exam day yet. Create one for the coming Friday.
          </p>
        ) : (
          <ul className="grid gap-1">
            {days.map((d) => {
              const active = selected?.id === d.id;
              return (
                <li key={d.id}>
                  <button
                    onClick={() => setSelectedId(d.id)}
                    className={
                      "w-full rounded px-2.5 py-2 text-left text-[13.5px] transition-colors " +
                      (active ? "bg-surface-3 font-semibold" : "hover:bg-surface-2")
                    }
                  >
                    <span className="block">{prettyDate(d.date)}</span>
                    <span className="block font-mono text-[11px] text-muted tnum">
                      {slotRange(d.startSlot, d.endSlot)} · {d.rooms.filter((r) => r.used !== false).length} rooms
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="grid gap-5">
        {!selected ? (
          <div className="card p-6 text-[13.5px] text-muted">Pick an exam day, or create one.</div>
        ) : (
          <>
            <div className="card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="mr-auto">
                  <h1 className="text-xl font-semibold">{selected.title || "Exam"}</h1>
                  <p className="mt-1 font-mono text-[12.5px] text-muted tnum">
                    {prettyDate(selected.date)} · {slotRange(selected.startSlot, selected.endSlot)}
                  </p>
                </div>
                <button className="btn" onClick={() => setEditing(selected)}>
                  Edit day
                </button>
                <button
                  className="btn"
                  onClick={() => downloadPdf(attendanceSheet(selected, duties, namesByEmail), "invigilation-" + selected.date + ".pdf")}
                >
                  Attendance PDF
                </button>
                <button className="btn btn-primary" onClick={() => void assign()}>
                  {assigned.length ? "Draw again" : "Assign invigilators"}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-5 text-[13px]">
                <Stat label="Seats needed" value={String(neededTotal)} />
                <Stat label="Assigned" value={String(assigned.length)} tone={assigned.length < neededTotal ? "warn" : "ok"} />
                <Stat
                  label="Spare teachers"
                  value={String(pool.filter((p) => !onDutyEmails.has(cleanEmail(p.email))).length)}
                  hint="free at this hour and not on duty"
                />
                <Stat
                  label="Busy with a class"
                  value={String(invigilators.filter((i) => i.active !== false && busy.has(cleanEmail(i.email))).length)}
                  hint="left out of the draw"
                />
                <Stat label="On standby" value={String(standby.length)} />
              </div>
              {assigned.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted">
                  Nobody is assigned yet. Press <strong>Assign invigilators</strong> — teachers who have their own class
                  in these hours are left out automatically.
                </p>
              ) : null}
            </div>

            {skipRequests.length > 0 ? (
              <div className="card border-pending-line p-4">
                <div className="label-xs text-pending">Skip requests</div>
                <ul className="mt-2 grid gap-2">
                  {skipRequests.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                      <strong className="font-semibold">{d.name}</strong>
                      <span className="text-muted">wants to drop {d.roomName}</span>
                      {d.skipReason ? <span className="text-ink-2">“{d.skipReason}”</span> : null}
                      <span className="ml-auto flex gap-2">
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            run(
                              decideSkip({ duty: d, approve: false, pool, takenEmails: duties.map((x) => x.email), by }),
                              d.name + " stays on " + d.roomName + "."
                            )
                          }
                        >
                          Keep them on
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() =>
                            run(
                              decideSkip({ duty: d, approve: true, pool, takenEmails: duties.map((x) => x.email), by }),
                              "Dropped. A replacement was drawn if anybody was free."
                            )
                          }
                        >
                          Allow and replace
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {swapRequests.length > 0 ? (
              <div className="card border-pending-line p-4">
                <div className="label-xs text-pending">Partner change requests</div>
                <p className="mt-1 text-[12.5px] text-muted">
                  A teacher asked for somebody who is not on duty. Approving takes the named colleague off this exam.
                </p>
                <ul className="mt-2 grid gap-2">
                  {swapRequests.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                      <strong className="font-semibold">{d.name}</strong>
                      <span className="text-muted">
                        would rather have <span className="text-ink">{d.swapWantName}</span> than {d.swapOutName} in{" "}
                        {d.roomName}
                      </span>
                      <span className="ml-auto flex gap-2">
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            run(decideSwapIn({ duty: d, approve: false, by }), "Left as it is.")
                          }
                        >
                          Leave it
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() =>
                            run(
                              decideSwapIn({ duty: d, approve: true, by }),
                              d.swapWantName + " is in, " + d.swapOutName + " is off."
                            )
                          }
                        >
                          Swap them
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {selected.rooms
                .filter((r) => r.used !== false)
                .map((room) => (
                  <RoomCard
                    key={room.roomId}
                    day={selected}
                    room={room}
                    duties={duties.filter((d) => d.roomId === room.roomId)}
                    allDuties={duties}
                    invigilators={invigilators}
                    tally={tally}
                    by={by}
                  />
                ))}
            </div>

            {standby.length ? (
              <div className="card p-4">
                <div className="label-xs">On standby</div>
                <p className="mt-2 text-[13.5px] text-ink-2">
                  {standby.map((e) => invigilators.find((i) => i.email === e)?.name || e).join(" · ")}
                </p>
                <p className="mt-1 text-[12.5px] text-muted">
                  Call one of these if somebody does not turn up on the day.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <a className="btn" href={seatingLink(undefined, selected.date)} target="_blank" rel="noopener noreferrer">
                Open the seating chart ↗
              </a>
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (!window.confirm("Delete " + prettyDate(selected.date) + " and all its duties?")) return;
                  run(deleteExamDay(selected).then(() => setSelectedId("")), "Exam day deleted.");
                }}
              >
                Delete this exam day
              </button>
            </div>
          </>
        )}
      </section>

      {creating ? (
        <DayForm
          initial={null}
          onClose={() => setCreating(false)}
          onSaved={(d) => {
            setSelectedId(d.id);
            setCreating(false);
          }}
        />
      ) : null}
      {editing ? (
        <DayForm initial={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "ok" | "warn"; hint?: string }) {
  return (
    <div title={hint}>
      <div className="label-xs">{label}</div>
      <div
        className={
          "mt-0.5 font-mono text-[18px] font-semibold tnum " +
          (tone === "warn" ? "text-pending" : tone === "ok" ? "text-free" : "")
        }
      >
        {value}
      </div>
      {hint ? <div className="text-[11.5px] text-muted">{hint}</div> : null}
    </div>
  );
}

function RoomCard({
  day,
  room,
  duties,
  allDuties,
  invigilators,
  tally,
  by,
}: {
  day: ExamDay;
  room: ExamRoomPlan;
  duties: Duty[];
  allDuties: Duty[];
  invigilators: Invigilator[];
  tally: Map<string, Tally>;
  by: { email: string; name: string };
}) {
  const { push } = useToast();
  const run = useRun();
  const [adding, setAdding] = useState("");
  const here = duties.filter((d) => d.status !== "skipped");
  const short = room.needed - here.length;
  const free = invigilators.filter(
    (i) => i.active !== false && !allDuties.some((d) => d.email === i.email && d.status !== "skipped")
  );
  // The other rooms on this exam day - empty when the exam uses one
  // room, and then there is nowhere to move anybody.
  const elsewhere = day.rooms.filter((r) => r.used !== false && r.roomId !== room.roomId);
  const marked = here.filter((d) => d.present != null).length;

  return (
    <div className="card p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold">{room.roomName}</h2>
        <span className="pill tnum">{room.capacity} seats</span>
        <span
          className={
            "ml-auto font-mono text-[12px] tnum " + (short > 0 ? "text-pending" : short < 0 ? "text-moved" : "text-muted")
          }
        >
          {here.length}/{room.needed}
        </span>
      </div>

      {here.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">
            {marked === here.length
              ? "Everybody marked"
              : marked + " of " + here.length + " marked"}
          </span>
          {marked < here.length ? (
            <button
              className="btn btn-sm ml-auto"
              title="Mark everybody in this room present"
              onClick={() =>
                run(
                  Promise.all(here.filter((d) => d.present == null).map((d) => markAttendance(d, true, by))),
                  "Everybody in " + room.roomName + " marked present."
                )
              }
            >
              All present
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="mt-3 grid gap-1.5">
        {here.length === 0 ? <li className="text-[13px] text-muted">Nobody yet.</li> : null}
        {here.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 rounded bg-surface-2 px-2.5 py-1.5 text-[13px]">
            <span className="font-medium">{d.name}</span>
            {d.partnerLocked ? (
              <button
                className="pill text-accent"
                title={"Fixed with " + (d.partnerName || "a colleague") + ". Click to undo the pair."}
                onClick={() => run(unlockPartner(d, by), "Pair undone. They can choose again.")}
              >
                paired with {d.partnerName}
              </button>
            ) : null}
            <span className="text-[11.5px] text-muted">
              {d.present != null
                ? (d.present ? "present" : "absent") + (d.markedBy ? " · marked by " + d.markedBy : "")
                : "not marked yet"}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button
                className={"btn btn-sm " + (d.present === true ? "btn-primary" : "")}
                title={d.present === true ? "Marked present - click to clear" : "Mark present"}
                onClick={() => run(markAttendance(d, d.present === true ? null : true, by))}
              >
                Present
              </button>
              <button
                className={"btn btn-sm " + (d.present === false ? "btn-danger" : "")}
                title={d.present === false ? "Marked absent - click to clear" : "Mark absent"}
                onClick={() => run(markAttendance(d, d.present === false ? null : false, by))}
              >
                Absent
              </button>
              <select
                className="input !w-auto !px-1.5 !py-0.5 text-[12px]"
                value=""
                disabled={elsewhere.length === 0}
                title={
                  elsewhere.length === 0
                    ? "Nowhere to move them - this exam uses one room"
                    : "Move this teacher to another room on this exam day"
                }
                onChange={(e) => {
                  const target = day.rooms.find((r) => r.roomId === e.target.value);
                  if (target) run(moveDuty(d, target, by), d.name + " moved to " + target.roomName + ".");
                }}
              >
                <option value="">Move…</option>
                {elsewhere.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.roomName}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-sm btn-danger"
                title="Take off duty"
                onClick={() => {
                  if (d.present != null && !window.confirm(d.name + " has already been marked. Take them off anyway?")) return;
                  run(removeDuty(d, by), d.name + " taken off " + d.roomName + ".");
                }}
              >
                −
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <select className="input" value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add a teacher…</option>
          {free.map((i) => (
            <option key={i.email} value={i.email}>
              {i.name} · {(tally.get(i.email) || EMPTY_TALLY).duties} duties
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!adding}
          onClick={() => {
            const person = invigilators.find((i) => i.email === adding);
            if (!person) return;
            run(
              addDuty({ day, room, person: { email: person.email, name: person.name }, by }).then(() => setAdding("")),
              person.name + " added to " + room.roomName + "."
            );
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function DayForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: ExamDay | null;
  onClose: () => void;
  onSaved: (d: ExamDay) => void;
}) {
  const { push } = useToast();
  const campus = useCampus();
  const [date, setDate] = useState(initial?.date || nextFriday());
  const [title, setTitle] = useState(initial?.title || "Weekly exam");
  // Exams run 09:00 to 12:00, so a new day starts there.
  const [startSlot, setStartSlot] = useState(initial?.startSlot ?? 0);
  const [endSlot, setEndSlot] = useState(initial?.endSlot ?? 5);
  const [reserveCount, setReserveCount] = useState(initial?.reserveCount ?? 2);
  const [rooms, setRooms] = useState<ExamRoomPlan[]>(
    () => {
      const fresh = roomPlansFrom(campus.rooms);
      if (!initial?.rooms?.length) return fresh;
      // Keep what was chosen, and let a room added to the campus since
      // then show up here too, unticked.
      const known = new Set(initial.rooms.map((r) => r.roomId));
      return [...initial.rooms, ...fresh.filter((r) => !known.has(r.roomId)).map((r) => ({ ...r, used: false }))];
    }
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!date) {
      push("Pick a date.", "bad");
      return;
    }
    if (endSlot < startSlot) {
      push("The end time is before the start time.", "bad");
      return;
    }
    setSaving(true);
    const now = Date.now();
    const day: ExamDay = {
      id: initial?.id || date,
      date,
      title: title.trim() || "Exam",
      startSlot,
      endSlot,
      rooms,
      reserves: initial?.reserves || [],
      reserveCount,
      status: initial?.status || "draft",
      createdAt: initial?.createdAt || now,
      updatedAt: now,
    };
    try {
      await saveExamDay(day);
      push(initial ? "Exam day updated." : "Exam day created.");
      onSaved(day);
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initial ? "Edit exam day" : "New exam day"}
      subtitle="Rooms, times, and how many invigilators each room needs"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : initial ? "Save changes" : "Create"}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="label-xs">Date</span>
            <input
              type="date"
              className="input"
              value={date}
              disabled={!!initial}
              title={initial ? "The duties are filed under this date. To move the exam, delete this day and make a new one." : ""}
              onChange={(e) => setDate(e.target.value)}
            />
            {initial ? (
              <span className="text-[12px] text-muted">
                Fixed — every duty is filed under it. To move the exam, delete this day and make a new one.
              </span>
            ) : null}
          </label>
          <label className="grid gap-1">
            <span className="label-xs">Name</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly exam" />
          </label>
          <label className="grid gap-1">
            <span className="label-xs">Starts</span>
            <select className="input" value={startSlot} onChange={(e) => setStartSlot(Number(e.target.value))}>
              {SLOTS.map((s) => (
                <option key={s.index} value={s.index}>
                  {s.start}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="label-xs">Ends</span>
            <select className="input" value={endSlot} onChange={(e) => setEndSlot(Number(e.target.value))}>
              {SLOTS.map((s) => (
                <option key={s.index} value={s.index}>
                  {s.end}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <div className="label-xs">Rooms and how many invigilators each needs</div>
          <p className="mt-1 text-[12.5px] text-muted">
            The suggested number is one invigilator per 40 seats. Change any of them.
          </p>
          <ul className="mt-2 grid gap-1.5">
            {rooms.map((r, i) => (
              <li key={r.roomId} className="flex items-center gap-3 rounded bg-surface-2 px-2.5 py-1.5">
                <label className="flex flex-1 items-center gap-2 text-[13.5px]">
                  <input
                    type="checkbox"
                    checked={r.used !== false}
                    onChange={(e) => {
                      const copy = [...rooms];
                      copy[i] = { ...r, used: e.target.checked };
                      setRooms(copy);
                    }}
                  />
                  <span className="font-medium">{r.roomName}</span>
                  <span className="pill tnum">{r.capacity} seats</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  className="input !w-16 tnum"
                  value={r.needed}
                  onChange={(e) => {
                    const copy = [...rooms];
                    copy[i] = { ...r, needed: Math.max(0, Number(e.target.value) || 0) };
                    setRooms(copy);
                  }}
                />
                <button
                  className="btn btn-sm"
                  title="Back to the suggested number"
                  onClick={() => {
                    const copy = [...rooms];
                    copy[i] = { ...r, needed: suggestNeeded(r.capacity) };
                    setRooms(copy);
                  }}
                >
                  Reset
                </button>
              </li>
            ))}
          </ul>
        </div>

        <label className="grid gap-1">
          <span className="label-xs">Teachers on standby</span>
          <input
            type="number"
            min={0}
            max={10}
            className="input !w-24 tnum"
            value={reserveCount}
            onChange={(e) => setReserveCount(Math.max(0, Number(e.target.value) || 0))}
          />
          <span className="text-[12.5px] text-muted">Picked in the same draw, in case somebody does not turn up.</span>
        </label>
      </div>
    </Modal>
  );
}

function nextFriday(): string {
  let d = todayISO();
  for (let i = 1; i <= 7; i++) {
    const cand = shiftDays(d, i);
    if (new Date(cand + "T00:00:00").getDay() === 5) return cand;
  }
  return shiftDays(d, 1);
}

// ------------------------------------------------------------
//  Teachers
// ------------------------------------------------------------

function TeachersPanel() {
  const { push } = useToast();
  const run = useRun();
  const campus = useCampus();
  const [list, setList] = useState<Invigilator[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => subscribeInvigilators(setList, (e) => push(e.message, "bad")), [push]);
  useEffect(() => subscribeAllDuties(setDuties, (e) => push(e.message, "bad")), [push]);

  const tally = useMemo(() => tallyDuties(duties), [duties]);
  const countOf = (email: string): Tally => tally.get(email) || EMPTY_TALLY;
  const average = list.length ? list.reduce((n, i) => n + countOf(i.email).duties, 0) / list.length : 0;

  return (
    <div className="grid gap-5">
      <div className="card p-4">
        <div className="label-xs">Add a teacher</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="input !w-56" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="input !w-72"
            placeholder="college email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={!name.trim() || !email.trim()}
            onClick={() =>
              void upsertInvigilator({ name, email })
                .then(() => {
                  setName("");
                  setEmail("");
                  push("Teacher added.");
                })
                .catch((e: Error) => push(e.message, "bad"))
            }
          >
            Add
          </button>
          <button
            className="btn"
            onClick={() =>
              importFaculty(campus.users).then(
                (n) => push(n ? n + " teachers brought in from the logins." : "Everybody with a login is already on the list."),
                (e: Error) => push(e.message, "bad")
              )
            }
          >
            Import everyone with a login
          </button>
        </div>
        <p className="mt-2 text-[12.5px] text-muted">
          A teacher does not need a login to be given duty. The email is how the duty finds them when they do sign in.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-line text-left">
              <Th>Teacher</Th>
              <Th>Email</Th>
              <Th right>Duties</Th>
              <Th right>Skips</Th>
              <Th>Last duty</Th>
              <Th right>Active</Th>
              <Th right></Th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.email} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium">{i.name}</td>
                <td className="px-3 py-2 font-mono text-[12px] text-muted">{i.email}</td>
                <td className="px-3 py-2 text-right font-mono tnum">
                  <span
                    className={
                      countOf(i.email).duties < average - 1
                        ? "text-free"
                        : countOf(i.email).duties > average + 1
                          ? "text-pending"
                          : ""
                    }
                  >
                    {countOf(i.email).duties}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tnum">{countOf(i.email).skips}</td>
                <td className="px-3 py-2 font-mono text-[12px] text-muted tnum">
                  {countOf(i.email).last ? prettyDate(countOf(i.email).last as string) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="checkbox"
                    checked={i.active !== false}
                    onChange={(e) => run(setInvigilatorActive(i.email, e.target.checked))}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      if (!window.confirm("Remove " + i.name + " from the invigilator list?")) return;
                      run(deleteInvigilator(i.email), i.name + " removed from the list.");
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted" colSpan={7}>
                  No teachers yet. Add them above, or import everyone who already has a login.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] text-muted">
        Green means fewer duties than average, amber means more. The draw already leans towards green, so this evens out
        on its own.
      </p>
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={"px-3 py-2 label-xs " + (right ? "text-right" : "")}>{children}</th>;
}

// ------------------------------------------------------------
//  Log
// ------------------------------------------------------------

function LogPanel() {
  const { push } = useToast();
  const [entries, setEntries] = useState<{ id: string; ts: number; action: string; text: string; date: string; byName: string }[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [invigilators, setInvigilators] = useState<Invigilator[]>([]);

  useEffect(() => subscribeLog(setEntries, (e) => push(e.message, "bad")), [push]);
  useEffect(() => subscribeAllDuties(setDuties, (e) => push(e.message, "bad")), [push]);
  useEffect(() => subscribeInvigilators(setInvigilators, () => {}), []);

  const tally = useMemo(() => tallyDuties(duties), [duties]);

  // Every teacher on the list, plus anybody who has a duty but has
  // since been taken off the list - their history still counts.
  const rows = useMemo(() => {
    const byEmail = new Map<string, string>();
    invigilators.forEach((i) => byEmail.set(i.email, i.name));
    duties.forEach((d) => { if (!byEmail.has(d.email)) byEmail.set(d.email, d.name); });
    return [...byEmail.entries()]
      .map(([email, name]) => ({ email, name, tally: tally.get(email) || EMPTY_TALLY }))
      .sort((a, b) => b.tally.duties - a.tally.duties || a.name.localeCompare(b.name));
  }, [invigilators, duties, tally]);

  const total = rows.reduce((n, r) => n + r.tally.duties, 0);
  const average = rows.length ? total / rows.length : 0;

  return (
    <div className="grid gap-5">
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <div className="mr-auto">
            <h2 className="text-[16px] font-semibold">Invigilations done, teacher by teacher</h2>
            <p className="mt-1 text-[13px] text-muted">
              Counted from the duties themselves, so it updates the moment anything changes — a draw, a swap, a drop.
            </p>
          </div>
          <span className="font-mono text-[12.5px] text-muted tnum">
            {total} duties · {average.toFixed(1)} each on average
          </span>
          <button
            className="btn"
            onClick={() =>
              downloadPdf(dutyLogSheet(rows, duties), "invigilation-record-" + new Date().toISOString().slice(0, 10) + ".pdf")
            }
          >
            Download PDF
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left">
                <Th>Teacher</Th>
                <Th right>Invigilations done</Th>
                <Th right>Dropped</Th>
                <Th>Last duty</Th>
                <Th>Rooms so far</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mine = duties.filter((d) => d.email === r.email && d.status !== "skipped");
                return (
                  <tr key={r.email} className="border-b border-line last:border-0 align-top">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono tnum">
                      <span
                        className={
                          r.tally.duties < average - 1 ? "text-free" : r.tally.duties > average + 1 ? "text-pending" : ""
                        }
                      >
                        {r.tally.duties}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tnum">{r.tally.skips || 0}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted tnum">
                      {r.tally.last ? prettyDate(r.tally.last) : "—"}
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-muted">
                      {mine.length
                        ? mine
                            .slice(0, 6)
                            .map((d) => d.roomName)
                            .join(", ") + (mine.length > 6 ? " +" + (mine.length - 6) + " more" : "")
                        : "—"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-muted" colSpan={5}>
                    Nobody has been given duty yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[16px] font-semibold">Everything that happened</h2>
        </div>
        <ul className="divide-y divide-line">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-2 px-4 py-2.5 text-[13.5px]">
              <span className="pill">{e.action}</span>
              <span>{e.text}</span>
              <span className="ml-auto font-mono text-[11.5px] text-muted tnum">
                {new Date(e.ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {e.byName}
              </span>
            </li>
          ))}
          {entries.length === 0 ? <li className="px-4 py-6 text-center text-muted">Nothing has happened yet.</li> : null}
        </ul>
      </div>
    </div>
  );
}
