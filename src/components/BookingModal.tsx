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
import { BookingConflict, createBooking, createRecurringBooking } from "@/lib/db";
import { notifyStudents } from "@/lib/notify";
import { prettyDate, shiftDays, shortDate, weekdayName } from "@/lib/dates";
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
        "rounded border px-3 py-2 text-[13px] " +
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
  const [sendEmail, setSendEmail] = useState(true);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [untilDate, setUntilDate] = useState(() => shiftDays(date, 7 * 15)); // ~one semester
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
    if (repeatWeekly && untilDate < date) return setErr("The repeat-until date can't be before the first session.");
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
        };

        try {
          if (repeatWeekly) {
            const result = await createRecurringBooking(input, untilDate);
            if (result.bookedDates.length === 0) {
              roomFailures.push(t.roomName + ": " + (result.skipped[0]?.reason || "no free week in that range"));
            } else {
              roomResults.push(
                t.roomName + " · " + result.bookedDates.length + " week" + (result.bookedDates.length === 1 ? "" : "s") +
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

      if (sendEmail) {
        for (const id of notifyIds) {
          const res = await notifyStudents(id, "booked");
          if (!res.ok) push(res.message, "bad");
        }
        if (notifyIds.length) push("Notified students for " + notifyIds.length + " booking" + (notifyIds.length === 1 ? "" : "s") + ".", "info");
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
        <div className="mb-4 rounded border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div>
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
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              checked={repeatWeekly}
              onChange={(e) => setRepeatWeekly(e.target.checked)}
            />
            <span className="text-[13.5px]">
              Repeat weekly
              <span className="mt-0.5 block text-[12px] text-muted">
                Books this exact room and hours every {weekdayName(date)} until the date below — a whole
                semester's timetable slot in one go. A week that clashes with something already booked is
                skipped automatically; you'll see which ones.
              </span>
            </span>
          </label>

          {repeatWeekly ? (
            <label className="mt-3 block max-w-[220px]">
              <span className="label-xs">Until (last {weekdayName(date)})</span>
              <input
                type="date"
                className="input mt-1.5"
                value={untilDate}
                min={date}
                onChange={(e) => e.target.value && setUntilDate(e.target.value)}
              />
              <span className="mt-1 block text-[12px] text-muted">
                {shortDate(date)} to {shortDate(untilDate)} ={" "}
                {Math.max(1, Math.floor((new Date(untilDate).getTime() - new Date(date).getTime()) / (7 * 86400000)) + 1)} weeks
              </span>
            </label>
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

        <label className="flex cursor-pointer items-start gap-2.5 sm:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--accent)]"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
          />
          <span className="text-[13.5px]">
            Email the selected batches now
            <span className="mt-0.5 block text-[12px] text-muted">
              Students always see it on the board either way. Email reaches those who have signed in at least once.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
