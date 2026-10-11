"use client";

// ============================================================
//  The booking form.
//
//  Everything that could clash is checked twice: the end-time
//  dropdown only offers hours that are actually free, and the
//  write itself runs inside a Firestore transaction, so even a
//  simultaneous booking from another laptop cannot slip through.
// ============================================================

import { useMemo, useState } from "react";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import {
  BookingConflict,
  createBooking,
  createRecurringBooking,
  describeRecurrence,
  MAX_OCCURRENCES,
  recurringDates,
  type RecurrenceRule,
} from "@/lib/db";
import { notifyStudents } from "@/lib/notify";
import { fromISO, prettyDate, shiftDays, shortDate, weekdayName } from "@/lib/dates";
import { formatDuration, SLOTS, slotRange } from "@/lib/slots";
import type { Kind, Room } from "@/lib/types";
import { Modal } from "./Modal";
import { BatchPicker } from "./BatchPicker";
import { useToast } from "./Toast";

const KIND_LABELS: Record<Kind, string> = {
  exam: "Exam",
  class: "Class",
  lab: "Lab",
  event: "Event",
};

/**
 * One extra room+batch pairing, for the "same time, different rooms"
 * pattern a lab needs - Batch 1 in one room, Batch 2 in another, both
 * at once. The primary room/batches above the split section count as
 * the first pairing; each row here adds one more.
 */
interface SplitRow {
  key: string;
  roomId: string;
  years: number[];
  batchIds: string[];
}

/** Fits-or-doesn't note shown under a room+batches pairing, reused for
 *  both the primary selection and each split row. */
function CapacityNote({
  needed,
  overCapacity,
  roomName,
  capacity,
}: {
  needed: number;
  overCapacity: boolean;
  roomName: string;
  capacity: number;
}) {
  return (
    <div
      className={
        "rounded-lg border px-3 py-2 text-[13px] " +
        (overCapacity ? "border-busy-line bg-busy-soft" : "border-free-line bg-free-soft")
      }
    >
      {overCapacity ? (
        <>
          <strong className="font-semibold">Too small.</strong> The selected batches come to{" "}
          <span className="tnum">{needed}</span> students but {roomName} seats only{" "}
          <span className="tnum">{capacity}</span>. You can still book it — but consider splitting
          across rooms.
        </>
      ) : (
        <>
          <span className="tnum">{needed}</span> students selected, {roomName} seats{" "}
          <span className="tnum">{capacity}</span>. Fits.
        </>
      )}
    </div>
  );
}

export function BookingModal({
  date,
  room: initialRoom,
  startSlot,
  onClose,
}: {
  date: string;
  room: Room;
  startSlot: number;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const { rooms, occupant, strengthOf } = useCampus();
  const { push } = useToast();

  const [roomId, setRoomId] = useState(initialRoom.id);
  const [endSlot, setEndSlot] = useState(startSlot);
  const [kind, setKind] = useState<Kind>("class");
  const [subject, setSubject] = useState(profile?.subjects?.[0] || "");
  const [title, setTitle] = useState("");
  const [years, setYears] = useState<number[]>(profile?.years || []);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [sendSlack, setSendSlack] = useState(true);
  // ---- repeat, Google-Calendar style ----
  // The rule fields below are the only real state. The quick-pick
  // dropdown is worked OUT from them (see `preset`), so picking "Every
  // weekday" and then ticking Saturday honestly turns it into "Custom"
  // instead of the two quietly disagreeing.
  const clickedDow = fromISO(date).getDay();
  const [repeating, setRepeating] = useState(false);
  const [every, setEvery] = useState(1);
  const [unit, setUnit] = useState<"day" | "week">("week");
  const [weekdays, setWeekdays] = useState<number[]>([clickedDow]);
  const [endType, setEndType] = useState<"on" | "after">("on");
  const [endDate, setEndDate] = useState(() => shiftDays(date, 7 * 15)); // ~one semester
  const [endCount, setEndCount] = useState(13);

  const rule: RecurrenceRule = {
    interval: every,
    unit,
    weekdays,
    end: endType === "on" ? { type: "on", date: endDate } : { type: "after", count: endCount },
  };
  // The exact dates this would book, from the same helper the write
  // uses - so the count shown here is the count that happens.
  const repeatDates = repeating ? recurringDates(date, rule) : [];

  const sameDays = (a: number[], b: number[]) => a.length === b.length && b.every((d) => a.includes(d));
  const preset: "none" | "daily" | "weekly" | "weekdays" | "custom" = !repeating
    ? "none"
    : every === 1 && unit === "day"
      ? "daily"
      : every === 1 && unit === "week" && sameDays(weekdays, [clickedDow])
        ? "weekly"
        : every === 1 && unit === "week" && sameDays(weekdays, [1, 2, 3, 4, 5])
          ? "weekdays"
          : "custom";

  function applyPreset(p: typeof preset) {
    if (p === "none") return setRepeating(false);
    setRepeating(true);
    if (p === "custom") return; // keep whatever is there, just open the editor
    setEvery(1);
    if (p === "daily") return setUnit("day");
    setUnit("week");
    setWeekdays(p === "weekdays" ? [1, 2, 3, 4, 5] : [clickedDow]);
  }

  function toggleWeekday(d: number) {
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }
  const [splitRows, setSplitRows] = useState<SplitRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const room = rooms.find((r) => r.id === roomId) || initialRoom;

  // Rooms already claimed by the primary selection or another split row -
  // offered nowhere else, so the same room can never be double-picked.
  const usedRoomIds = [roomId, ...splitRows.map((r) => r.roomId)].filter(Boolean);
  // Batches already claimed anywhere - a batch can only be in one room
  // for this slot, whether that's a lab split or just this one booking.
  const usedBatchIds = [...batchIds, ...splitRows.flatMap((r) => r.batchIds)];

  function addSplitRow() {
    const freeRoom = rooms.find((r) => r.active && !usedRoomIds.includes(r.id) && !occupant(date, r.id, startSlot));
    setSplitRows((cur) => [
      ...cur,
      { key: (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random())), roomId: freeRoom?.id || "", years: [], batchIds: [] },
    ]);
  }
  function removeSplitRow(key: string) {
    setSplitRows((cur) => cur.filter((r) => r.key !== key));
  }
  function updateSplitRow(key: string, patch: Partial<SplitRow>) {
    setSplitRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Hours from startSlot that are still free in the chosen room. */
  const endOptions = useMemo(() => {
    const out: number[] = [];
    for (let s = startSlot; s < SLOTS.length; s++) {
      if (occupant(date, roomId, s)) break;
      out.push(s);
    }
    return out;
  }, [date, roomId, startSlot, occupant]);

  // If the room changes and the chosen end is no longer free, pull it back.
  const safeEnd = endOptions.includes(endSlot) ? endSlot : startSlot;

  const needed = strengthOf(batchIds);
  const overCapacity = needed > room.capacity;

  const subjectChoices = Array.from(
    new Set([...(profile?.subjects || []), subject].filter(Boolean))
  );

  async function submit() {
    setErr(null);
    if (!profile) return setErr("Your profile is still loading. Try again in a moment.");
    if (!subject.trim()) return setErr("Which subject is this? Add subjects to your profile to have this pre-filled.");
    if (!title.trim()) return setErr("Add a short description — it is what students see on the board.");
    if (batchIds.length === 0) return setErr("Pick at least one batch, or a whole year, for " + room.name + ".");
    if (endOptions.length === 0) return setErr("That hour is no longer free. Close this and pick another.");
    if (repeating) {
      if (!Number.isFinite(every) || every < 1) return setErr("Repeat every must be at least 1.");
      if (unit === "week" && weekdays.length === 0) return setErr("Pick at least one day to repeat on.");
      if (endType === "on" && endDate < date) return setErr("The end date can't be before the first session.");
      if (endType === "after" && (!Number.isFinite(endCount) || endCount < 1)) {
        return setErr("Ends after needs at least 1 occurrence.");
      }
      if (repeatDates.length === 0) return setErr("That repeat doesn't land on any date before it ends.");
    }
    for (const row of splitRows) {
      const rn = rooms.find((r) => r.id === row.roomId)?.name || "one of the split rooms";
      if (!row.roomId) return setErr("Pick a room for every split row, or remove the empty one.");
      if (row.batchIds.length === 0) return setErr("Pick at least one batch for " + rn + ", or remove that row.");
    }

    setBusy(true);
    try {
      type Target = { roomId: string; roomName: string; years: number[]; batchIds: string[] };
      const targets: Target[] = [
        { roomId, roomName: room.name, years, batchIds },
        ...splitRows.map((r) => ({
          roomId: r.roomId,
          roomName: rooms.find((x) => x.id === r.roomId)?.name || r.roomId,
          years: r.years,
          batchIds: r.batchIds,
        })),
      ];

      const notifyIds: string[] = [];
      const roomResults: string[] = [];
      const roomFailures: string[] = [];

      for (const t of targets) {
        const input = {
          date,
          roomId: t.roomId,
          roomName: t.roomName,
          startSlot,
          endSlot: safeEnd,
          kind,
          subject: subject.trim(),
          title: title.trim(),
          facultyUid: profile.uid,
          facultyName: profile.name,
          years: t.years,
          batchIds: t.batchIds,
          note: note.trim(),
          // A teacher's booking holds the room but waits for an admin
          // to sign it off; an admin booking needs nobody's approval.
          approved: profile.role === "admin",
        };

        try {
          if (repeating) {
            const result = await createRecurringBooking(input, rule);
            if (result.bookedDates.length === 0) {
              roomFailures.push(t.roomName + ": " + (result.skipped[0]?.reason || "no free date in that repeat"));
            } else {
              roomResults.push(
                t.roomName + " · " + result.bookedDates.length + " session" + (result.bookedDates.length === 1 ? "" : "s") +
                (result.skipped.length ? " (" + result.skipped.length + " skipped)" : "")
              );
              if (result.firstBookingId) notifyIds.push(result.firstBookingId);
            }
          } else {
            const id = await createBooking(input);
            roomResults.push(t.roomName);
            notifyIds.push(id);
          }
        } catch (e) {
          const msg = e instanceof BookingConflict ? e.detail : e instanceof Error ? e.message : "Could not book it.";
          roomFailures.push(t.roomName + ": " + msg);
        }
      }

      if (roomResults.length === 0) {
        setErr(roomFailures.join(" · ") || "Nothing could be booked.");
        setBusy(false);
        return;
      }

      push(
        (targets.length > 1 ? "Booked " + roomResults.join(" · ") : roomResults[0] + " booked") +
        " · " + slotRange(startSlot, safeEnd) +
        (roomFailures.length ? " — failed: " + roomFailures.join(" · ") : "")
      );

      // Each channel is its own checkbox now - only call at all if at
      // least one of them is actually wanted for this booking.
      if (sendSlack) {
        for (const id of notifyIds) {
          const res = await notifyStudents(id, "booked", undefined, sendSlack);
          if (!res.ok) push(res.message, "bad");
        }
      }
      onClose();
    } catch (e) {
      if (e instanceof BookingConflict) setErr(e.detail);
      else if (e instanceof Error && e.message.toLowerCase().includes("permission"))
        setErr("Firestore refused the write. Your role may not be faculty yet — ask an admin to check Admin → People.");
      else setErr(e instanceof Error ? e.message : "Could not save the booking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={"Book " + room.name}
      subtitle={prettyDate(date) + " · from " + SLOTS[startSlot].start}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Confirm booking"}
          </button>
        </>
      }
    >
      {err ? (
        <div className="mb-4 rounded-lg border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label-xs">Room</span>
          <select className="input mt-1.5" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.filter((r) => r.active).map((r) => {
              const busyHere = Boolean(occupant(date, r.id, startSlot));
              return (
                <option key={r.id} value={r.id} disabled={busyHere}>
                  {r.name}{r.note ? " — " + r.note : ""} · {r.capacity} seats{busyHere ? " (taken)" : ""}
                </option>
              );
            })}
          </select>
        </label>

        <label className="block">
          <span className="label-xs">Until</span>
          <select
            className="input mt-1.5"
            value={safeEnd}
            onChange={(e) => setEndSlot(Number(e.target.value))}
          >
            {endOptions.map((s) => (
              <option key={s} value={s}>
                {SLOTS[startSlot].start}–{SLOTS[s].end} ({formatDuration(startSlot, s)})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label-xs">Type</span>
          <select className="input mt-1.5" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label-xs">Subject</span>
          {subjectChoices.length > 1 ? (
            <select className="input mt-1.5" value={subject} onChange={(e) => setSubject(e.target.value)}>
              {subjectChoices.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <input
              className="input mt-1.5"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Robotics"
            />
          )}
        </label>

        <label className="block sm:col-span-2">
          <span className="label-xs">Short description</span>
          <input
            className="input mt-1.5"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Mid-term paper, or Line-follower demo"
            maxLength={80}
          />
          <span className="mt-1 block text-[12px] text-muted">
            Shown on the board next to your name, so other teachers can see what the room is being used for.
          </span>
        </label>

        <div className="sm:col-span-2">
          <span className="label-xs">Who is invited{splitRows.length ? " — " + room.name : ""}</span>
          <div className="mt-2">
            <BatchPicker
              years={years}
              batchIds={batchIds}
              hideIds={splitRows.flatMap((r) => r.batchIds)}
              onChange={(next) => {
                setYears(next.years);
                setBatchIds(next.batchIds);
              }}
            />
          </div>
        </div>

        {batchIds.length ? <CapacityNote needed={needed} overCapacity={overCapacity} roomName={room.name} capacity={room.capacity} /> : null}

        <div className="sm:col-span-2 space-y-3">
          {splitRows.map((row) => {
            const rowRoom = rooms.find((r) => r.id === row.roomId);
            const rowNeeded = strengthOf(row.batchIds);
            const rowOverCapacity = rowRoom ? rowNeeded > rowRoom.capacity : false;
            return (
              <div key={row.key} className="rounded-lg border border-line-strong bg-surface p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <label className="block max-w-[280px] flex-1">
                    <span className="label-xs">Same time, another room</span>
                    <select
                      className="input mt-1.5"
                      value={row.roomId}
                      onChange={(e) => updateSplitRow(row.key, { roomId: e.target.value })}
                    >
                      <option value="" disabled>Choose a room…</option>
                      {rooms.filter((r) => r.active && (r.id === row.roomId || !usedRoomIds.includes(r.id))).map((r) => {
                        const busyHere = Boolean(occupant(date, r.id, startSlot));
                        return (
                          <option key={r.id} value={r.id} disabled={busyHere}>
                            {r.name}{r.note ? " — " + r.note : ""} · {r.capacity} seats{busyHere ? " (taken)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm mt-5 shrink-0"
                    onClick={() => removeSplitRow(row.key)}
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3">
                  <span className="label-xs">Batches in {rowRoom?.name || "this room"}</span>
                  <div className="mt-2">
                    <BatchPicker
                      years={row.years}
                      batchIds={row.batchIds}
                      hideIds={usedBatchIds.filter((id) => !row.batchIds.includes(id))}
                      onChange={(next) => updateSplitRow(row.key, { years: next.years, batchIds: next.batchIds })}
                    />
                  </div>
                </div>

                {row.batchIds.length && rowRoom ? (
                  <div className="mt-3">
                    <CapacityNote needed={rowNeeded} overCapacity={rowOverCapacity} roomName={rowRoom.name} capacity={rowRoom.capacity} />
                  </div>
                ) : null}
              </div>
            );
          })}

          <button type="button" className="btn btn-sm" onClick={addSplitRow}>
            + Split into another room
          </button>
          <p className="text-[12px] text-muted">
            For a lab where each batch goes to a different room at the same time. Every teacher, room and
            batch here books at exactly this date and hours — {prettyDate(date)}, {slotRange(startSlot, safeEnd)}.
          </p>
        </div>

        <div className="rounded-lg border border-line bg-surface-2 p-3.5 sm:col-span-2">
          {/* Quick picks, as in Calendar's dropdown. Worked out from the
              rule below rather than stored, so it always tells the truth. */}
          <label className="block max-w-[300px]">
            <span className="label-xs">Repeat</span>
            <select
              className="input mt-1.5"
              value={preset}
              onChange={(e) => applyPreset(e.target.value as typeof preset)}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly on {weekdayName(date)}</option>
              <option value="weekdays">Every weekday (Mon–Fri)</option>
              <option value="custom">Custom…</option>
            </select>
          </label>

          {repeating ? (
            <div className="mt-4 space-y-4">
              {/* Repeat every [N] [day | week] */}
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[13.5px]">Repeat every</span>
                <input
                  type="number"
                  min={1}
                  max={52}
                  className="input w-[72px] text-center tnum"
                  value={every}
                  onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))}
                />
                <select
                  className="input w-auto"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as "day" | "week")}
                >
                  <option value="day">{every === 1 ? "day" : "days"}</option>
                  <option value="week">{every === 1 ? "week" : "weeks"}</option>
                </select>
              </div>

              {/* Repeat on - weeks only, like Calendar */}
              {unit === "week" ? (
                <div>
                  <span className="label-xs">Repeat on</span>
                  <div className="mt-2 flex gap-1.5">
                    {["S", "M", "T", "W", "T", "F", "S"].map((letter, d) => {
                      const on = weekdays.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d]}
                          onClick={() => toggleWeekday(d)}
                          className={
                            "flex h-9 w-9 items-center justify-center rounded-full border text-[12.5px] font-semibold transition-colors " +
                            (on
                              ? "border-accent bg-accent text-[var(--accent-ink)]"
                              : "border-line bg-surface text-muted hover:text-ink")
                          }
                        >
                          {letter}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Ends */}
              <div>
                <span className="label-xs">Ends</span>
                <div className="mt-2 space-y-2">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="radio"
                      name="repeat-end"
                      className="accent-[var(--accent)]"
                      checked={endType === "on"}
                      onChange={() => setEndType("on")}
                    />
                    <span className="w-[56px] text-[13.5px]">On</span>
                    <input
                      type="date"
                      className="input w-auto"
                      value={endDate}
                      min={date}
                      disabled={endType !== "on"}
                      onChange={(e) => e.target.value && setEndDate(e.target.value)}
                    />
                  </label>
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="radio"
                      name="repeat-end"
                      className="accent-[var(--accent)]"
                      checked={endType === "after"}
                      onChange={() => setEndType("after")}
                    />
                    <span className="w-[56px] text-[13.5px]">After</span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_OCCURRENCES}
                      className="input w-[84px] text-center tnum"
                      value={endCount}
                      disabled={endType !== "after"}
                      onChange={(e) => setEndCount(Math.max(1, Math.min(MAX_OCCURRENCES, Number(e.target.value) || 1)))}
                    />
                    <span className="text-[13.5px] text-muted">occurrences</span>
                  </label>
                </div>
                <p className="mt-2 text-[12px] text-muted">
                  There&apos;s no &ldquo;never&rdquo; — every session holds a real room, so a repeat has to stop somewhere.
                </p>
              </div>

              {/* What will actually happen. The FIRST booked date, not the
                  clicked one: Mon–Fri started on a Sunday really begins
                  that Monday, and this is where that becomes visible. */}
              <div className="rounded border border-line bg-surface px-3 py-2.5 text-[12.5px]">
                {repeatDates.length ? (
                  <>
                    <span className="font-semibold">{describeRecurrence(rule)}</span>
                    {" · "}
                    {repeatDates.length} {repeatDates.length === 1 ? "session" : "sessions"}
                    {", "}
                    {shortDate(repeatDates[0])} → {shortDate(repeatDates[repeatDates.length - 1])}
                    <span className="mt-1 block text-muted">
                      Any date that clashes with something already booked is skipped on its own; you&apos;ll see which.
                    </span>
                  </>
                ) : (
                  <span className="text-busy">
                    {unit === "week" && weekdays.length === 0
                      ? "Pick at least one day to repeat on."
                      : "This repeat doesn't land on any date before it ends."}
                  </span>
                )}
                {repeatDates.length > 60 ? (
                  <span className="mt-1 block font-medium text-pending">
                    That&apos;s a lot of bookings in one go — double-check when it ends.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <label className="block sm:col-span-2">
          <span className="label-xs">Note for students (optional)</span>
          <textarea
            className="input mt-1.5 min-h-[70px] resize-y"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Bring your ID card. Calculators allowed."
          />
        </label>

        {profile?.role === "admin" && (
          <label className="flex cursor-pointer items-start gap-2.5 sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              checked={sendSlack}
              onChange={(e) => setSendSlack(e.target.checked)}
            />
            <span className="text-[13.5px]">
              Post to Slack
              <span className="mt-0.5 block text-[12px] text-muted">
                On by default - untick to skip Slack just for this booking. Admin only, teachers don't see this.
              </span>
            </span>
          </label>
        )}

      </div>
    </Modal>
  );
}
