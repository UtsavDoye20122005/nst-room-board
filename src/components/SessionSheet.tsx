"use client";

// ============================================================
//  Session details, plus everything a teacher can do to it:
//  change the room, cancel it, put it back, remove it.
//
//  Each action runs as a transaction and then offers to announce
//  the affected batches.
// ============================================================

import { useState } from "react";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import {
  approveBooking,
  BookingConflict,
  cancelBooking,
  cancelSeriesFromDate,
  deleteBooking,
  moveBooking,
  reinstateBooking,
  seriesLabelOf,
  updateBooking,
} from "@/lib/db";
import { notifyStudents } from "@/lib/notify";
import { clockTime, prettyDate, shortDate } from "@/lib/dates";
import { SLOTS, formatDuration, slotRange } from "@/lib/slots";
import { yearLabel } from "@/lib/seedData";
import type { Booking, Kind } from "@/lib/types";
import { seatingLink } from "@/lib/links";
import { BatchPicker } from "./BatchPicker";
import { Modal } from "./Modal";
import { useToast } from "./Toast";

type Pane = "detail" | "move" | "cancel" | "edit";

export function SessionSheet({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { profile } = useAuth();
  const { roomById, roomName, batchNames, occupant, rooms, bookings } = useCampus();
  const { push } = useToast();

  const [pane, setPane] = useState<Pane>("detail");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [toRoom, setToRoom] = useState("");
  const [sendSlack, setSendSlack] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cancelWholeSeries, setCancelWholeSeries] = useState(false);

  // Edit pane. Seeded from the booking and only read while that pane
  // is open, so reopening it always starts from what is actually saved.
  const [eSubject, setESubject] = useState(booking.subject);
  const [eTitle, setETitle] = useState(booking.title);
  const [eKind, setEKind] = useState<Kind>(booking.kind);
  const [eNote, setENote] = useState(booking.note || "");
  const [eYears, setEYears] = useState<number[]>(booking.years || []);
  const [eBatchIds, setEBatchIds] = useState<string[]>(booking.batchIds || []);
  const [eStart, setEStart] = useState(booking.startSlot);
  const [eEnd, setEEnd] = useState(booking.endSlot);

  function openEdit() {
    setESubject(booking.subject);
    setETitle(booking.title);
    setEKind(booking.kind);
    setENote(booking.note || "");
    setEYears(booking.years || []);
    setEBatchIds(booking.batchIds || []);
    setEStart(booking.startSlot);
    setEEnd(booking.endSlot);
    setErr(null);
    setPane("edit");
  }

  const room = roomById(booking.roomId);
  const isOwner = profile?.uid === booking.facultyUid;
  const isAdmin = profile?.role === "admin";
  const canEdit = Boolean(profile && (profile.role === "faculty" || isAdmin) && (isOwner || isAdmin));
  const cancelled = booking.status === "cancelled";
  // Undefined means approved - everything booked before approvals
  // existed, and every seeded timetable row, is already legitimate.
  const awaitingApproval = booking.approved === false;
  // Room taken back by the official timetable. Still the teacher's
  // session - it just has nowhere to be until they re-room it, which
  // is why "Change room" stays available below.
  const displaced = booking.status === "displaced";

  // How many confirmed weeks of this series are still loaded (the board
  // only keeps ~3 weeks of history + whatever is ahead, so this counts
  // what's visible, not necessarily the whole semester).
  const seriesAheadCount = booking.seriesId
    ? bookings.filter(
        (b) => b.seriesId === booking.seriesId && b.date > booking.date && b.status === "confirmed"
      ).length
    : 0;

  const otherRooms = rooms.filter((r) => r.active && r.id !== booking.roomId);

  function freeFor(roomId: string): boolean {
    for (let s = booking.startSlot; s <= booking.endSlot; s++) {
      if (occupant(booking.date, roomId, s)) return false;
    }
    return true;
  }

  async function withBusy(fn: () => Promise<void>) {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof BookingConflict) setErr(e.detail);
      else setErr(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------- move ----------------
  if (pane === "move") {
    const target = toRoom || otherRooms.find((r) => freeFor(r.id))?.id || "";
    return (
      <Modal
        title="Change room"
        subtitle={booking.subject + " · " + prettyDate(booking.date) + " · " + slotRange(booking.startSlot, booking.endSlot)}
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={() => setPane("detail")} disabled={busy}>Back</button>
            <button
              className="btn btn-primary"
              disabled={busy || !target}
              onClick={() =>
                void withBusy(async () => {
                  const from = roomName(booking.roomId);
                  const to = roomName(target);
                  await moveBooking(booking, target, from, to, profile!.uid, profile!.name);
                  push("Moved to " + to);
                  if (sendSlack) {
                    const res = await notifyStudents(booking.id, "moved", undefined, sendSlack);
                    push(res.message, res.ok ? "info" : "bad");
                  }
                  onClose();
                })
              }
            >
              {busy ? "Moving…" : "Move it"}
            </button>
          </>
        }
      >
        {err ? <div className="mb-4 rounded-lg border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div> : null}

        <label className="block">
          <span className="label-xs">Move to</span>
          <select className="input mt-1.5" value={target} onChange={(e) => setToRoom(e.target.value)}>
            {otherRooms.map((r) => {
              const free = freeFor(r.id);
              return (
                <option key={r.id} value={r.id} disabled={!free}>
                  {r.name}{r.note ? " — " + r.note : ""} · {r.capacity} seats{free ? "" : " — busy"}
                </option>
              );
            })}
          </select>
        </label>

        <p className="mt-3 text-[13px] text-muted">
          Rooms already taken for these hours cannot be chosen. Moving marks the session as moved on the
          board and posts a room-change notice.
        </p>

        {profile?.role === "admin" && (
          <label className="mt-4 flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={sendSlack} onChange={(e) => setSendSlack(e.target.checked)} />
            <span className="text-[13.5px]">
              Post to Slack
              <span className="mt-0.5 block text-[12px] text-muted">On by default. Admin only.</span>
            </span>
          </label>
        )}

      </Modal>
    );
  }

  // ---------------- edit ----------------
  if (pane === "edit") {
    // Hours this session could run to without walking into somebody
    // else. Its own current hours never count as a clash with itself.
    const endChoices: number[] = [];
    for (let s = eStart; s < SLOTS.length; s++) {
      const held = occupant(booking.date, booking.roomId, s);
      if (held && held.id !== booking.id) break;
      endChoices.push(s);
    }
    const safeEnd = endChoices.includes(eEnd) ? eEnd : eStart;

    return (
      <Modal
        title="Edit session"
        subtitle={roomName(booking.roomId) + " · " + prettyDate(booking.date)}
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={() => setPane("detail")} disabled={busy}>Back</button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void withBusy(async () => {
                  if (!eSubject.trim()) throw new Error("Which subject is this?");
                  if (!eTitle.trim()) throw new Error("Add a short description — it is what students see.");
                  if (eBatchIds.length === 0) throw new Error("Pick at least one batch, or a whole year.");

                  const timeChanged = eStart !== booking.startSlot || safeEnd !== booking.endSlot;
                  await updateBooking(
                    booking,
                    {
                      subject: eSubject.trim(),
                      title: eTitle.trim(),
                      kind: eKind,
                      note: eNote.trim(),
                      years: eYears,
                      batchIds: eBatchIds,
                      startSlot: eStart,
                      endSlot: safeEnd,
                    },
                    roomName(booking.roomId),
                    profile!.uid,
                    profile!.name
                  );
                  push("Session updated");
                  // Only a time change is worth telling anyone about -
                  // same rule the notice in db.ts follows.
                  if (timeChanged) {
                    const res = await notifyStudents(booking.id, "moved", undefined, sendSlack);
                    push(res.message, res.ok ? "info" : "bad");
                  }
                  onClose();
                })
              }
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        {err ? <div className="mb-4 rounded-lg border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div> : null}

        {booking.seriesId ? (
          <div className="mb-4 rounded-lg border border-moved-line bg-moved-soft px-3 py-2.5 text-[13px]">
            <strong className="font-semibold">This is one session of a repeating series.</strong> Changes
            here apply to this {shortDate(booking.date)} session only — the other sessions stay as they are.
          </div>
        ) : null}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="block">
            <span className="label-xs">Subject</span>
            <input className="input mt-1.5" value={eSubject} onChange={(e) => setESubject(e.target.value)} />
          </label>

          <label className="block">
            <span className="label-xs">Type</span>
            <select className="input mt-1.5" value={eKind} onChange={(e) => setEKind(e.target.value as Kind)}>
              <option value="class">Class</option>
              <option value="lab">Lab</option>
              <option value="exam">Exam</option>
              <option value="event">Event</option>
            </select>
          </label>

          <label className="block sm:col-span-2">
            <span className="label-xs">Short description</span>
            <input className="input mt-1.5" value={eTitle} onChange={(e) => setETitle(e.target.value)} />
          </label>

          <label className="block">
            <span className="label-xs">From</span>
            <select
              className="input mt-1.5"
              value={eStart}
              onChange={(e) => {
                const next = Number(e.target.value);
                setEStart(next);
                if (next > eEnd) setEEnd(next);
              }}
            >
              {SLOTS.map((s) => {
                const held = occupant(booking.date, booking.roomId, s.index);
                const taken = Boolean(held && held.id !== booking.id);
                return (
                  <option key={s.index} value={s.index} disabled={taken}>
                    {s.start}{taken ? " — busy" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="block">
            <span className="label-xs">Until</span>
            <select className="input mt-1.5" value={safeEnd} onChange={(e) => setEEnd(Number(e.target.value))}>
              {endChoices.map((s) => (
                <option key={s} value={s}>
                  {SLOTS[s].end} ({formatDuration(eStart, s)})
                </option>
              ))}
            </select>
          </label>

          <div className="sm:col-span-2">
            <span className="label-xs">Who is invited</span>
            <div className="mt-2">
              <BatchPicker
                years={eYears}
                batchIds={eBatchIds}
                onChange={(next) => {
                  setEYears(next.years);
                  setEBatchIds(next.batchIds);
                }}
              />
            </div>
          </div>

          <label className="block sm:col-span-2">
            <span className="label-xs">Note for students (optional)</span>
            <textarea
              className="input mt-1.5 min-h-[70px] resize-y"
              value={eNote}
              onChange={(e) => setENote(e.target.value)}
            />
          </label>
        </div>

        <p className="mt-3 text-[13px] text-muted">
          To change the room, use “Change room” instead. A notice goes out only if you change the hours.
        </p>

        {profile?.role === "admin" && (
          <label className="mt-4 flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={sendSlack} onChange={(e) => setSendSlack(e.target.checked)} />
            <span className="text-[13.5px]">
              Post to Slack if the hours change
              <span className="mt-0.5 block text-[12px] text-muted">On by default. Admin only.</span>
            </span>
          </label>
        )}
      </Modal>
    );
  }

  // ---------------- cancel ----------------
  if (pane === "cancel") {
    const isSeries = Boolean(booking.seriesId) && seriesAheadCount > 0;

    return (
      <Modal
        title="Cancel session"
        subtitle={booking.subject + " · " + prettyDate(booking.date) + " · " + slotRange(booking.startSlot, booking.endSlot)}
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={() => setPane("detail")} disabled={busy}>Back</button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                void withBusy(async () => {
                  if (cancelWholeSeries && booking.seriesId) {
                    const n = await cancelSeriesFromDate(
                      booking.seriesId, booking.date, bookings, roomName(booking.roomId),
                      reason.trim(), profile!.uid, profile!.name
                    );
                    push(n + " week" + (n === 1 ? "" : "s") + " cancelled, from " + shortDate(booking.date) + " onward");
                    if (sendSlack) {
                      const res = await notifyStudents(booking.id, "cancelled", reason.trim(), sendSlack);
                      push(res.message, res.ok ? "info" : "bad");
                    }
                  } else {
                    await cancelBooking(booking, roomName(booking.roomId), reason.trim(), profile!.uid, profile!.name);
                    push("This week cancelled" + (isSeries ? " — the rest of the series is untouched" : ""));
                    if (sendSlack) {
                      const res = await notifyStudents(booking.id, "cancelled", reason.trim(), sendSlack);
                      push(res.message, res.ok ? "info" : "bad");
                    }
                  }
                  onClose();
                })
              }
            >
              {busy ? "Cancelling…" : cancelWholeSeries ? "Cancel the series" : isSeries ? "Cancel just this week" : "Cancel the session"}
            </button>
          </>
        }
      >
        {err ? <div className="mb-4 rounded-lg border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div> : null}

        {isSeries ? (
          <div className="mb-4 space-y-2">
            <span className="label-xs">This is part of a repeating series — {seriesLabelOf(booking).toLowerCase()}</span>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line-strong bg-surface p-3">
              <input
                type="radio"
                className="mt-0.5 accent-[var(--accent)]"
                checked={!cancelWholeSeries}
                onChange={() => setCancelWholeSeries(false)}
              />
              <span className="text-[13.5px]">
                Just this one ({shortDate(booking.date)})
                <span className="mt-0.5 block text-[12px] text-muted">
                  The other {seriesAheadCount} upcoming session{seriesAheadCount === 1 ? "" : "s"} stay booked.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line-strong bg-surface p-3">
              <input
                type="radio"
                className="mt-0.5 accent-[var(--accent)]"
                checked={cancelWholeSeries}
                onChange={() => setCancelWholeSeries(true)}
              />
              <span className="text-[13.5px]">
                This and every later session in the series
                <span className="mt-0.5 block text-[12px] text-muted">
                  Ends the series from {shortDate(booking.date)} onward — {seriesAheadCount + 1} sessions in total.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        <label className="block">
          <span className="label-xs">Reason students will see</span>
          <input
            className="input mt-1.5"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Faculty on leave"
          />
        </label>

        <p className="mt-3 text-[13px] text-muted">
          The session stays on the board struck through in grey so nobody turns up, and{" "}
          {roomName(booking.roomId)} becomes free for other teachers straight away. You can put it back later.
        </p>

        {profile?.role === "admin" && (
          <label className="mt-4 flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={sendSlack} onChange={(e) => setSendSlack(e.target.checked)} />
            <span className="text-[13.5px]">
              Post to Slack
              <span className="mt-0.5 block text-[12px] text-muted">On by default. Admin only.</span>
            </span>
          </label>
        )}

      </Modal>
    );
  }

  // ---------------- detail ----------------
  return (
    <Modal
      title={booking.subject + (booking.title ? " — " + booking.title : "")}
      subtitle={
        booking.kind.toUpperCase() + " · " + prettyDate(booking.date) + " · " + slotRange(booking.startSlot, booking.endSlot)
      }
      onClose={onClose}
      footer={
        <>
          {canEdit ? (
            <button
              className="btn btn-sm btn-danger mr-auto"
              disabled={busy}
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                void withBusy(async () => {
                  await deleteBooking(booking, roomName(booking.roomId), profile!.uid, profile!.name);
                  push("Removed from the board");
                  onClose();
                });
              }}
            >
              {confirmDelete ? "Click again to remove" : "Remove from board"}
            </button>
          ) : null}

          {booking.kind === "exam" ? (
            <a
              className="btn"
              href={seatingLink(roomName(booking.roomId), booking.date)}
              target="_blank"
              rel="noopener noreferrer"
              title="Who sits where in this room"
            >
              Seating chart ↗
            </a>
          ) : null}

          <button className="btn" onClick={onClose} disabled={busy}>Close</button>

          {/* Editable while cancelled too: fixing the details and then
              putting it back on is the normal way to reschedule one. */}
          {canEdit && cancelled ? (
            <button className="btn" onClick={openEdit} disabled={busy}>Edit session</button>
          ) : null}

          {canEdit && cancelled ? (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void withBusy(async () => {
                  await reinstateBooking(booking, roomName(booking.roomId), profile!.uid, profile!.name);
                  push("Session reinstated");
                  const res = await notifyStudents(booking.id, "reinstated");
                  push(res.message, res.ok ? "info" : "bad");
                  onClose();
                })
              }
            >
              {busy ? "Working…" : "Put it back on"}
            </button>
          ) : null}

          {canEdit && !cancelled ? (
            <>
              <button className="btn" onClick={openEdit}>Edit session</button>
              <button className="btn" onClick={() => setPane("move")}>Change room</button>
              <button className="btn btn-danger" onClick={() => setPane("cancel")}>Cancel session</button>
            </>
          ) : null}

          {isAdmin && awaitingApproval && !cancelled ? (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void withBusy(async () => {
                  await approveBooking(booking, roomName(booking.roomId), profile!.uid, profile!.name);
                  push("Approved — the session is now confirmed");
                  onClose();
                })
              }
            >
              {busy ? "Working…" : "Approve"}
            </button>
          ) : null}
        </>
      }
    >
      {err ? <div className="mb-4 rounded-lg border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div> : null}

      {cancelled ? (
        <div className="mb-4 rounded-lg border border-off-line bg-off-soft px-3 py-2.5 text-[13px]">
          <strong className="font-semibold">This session is cancelled.</strong>
          {booking.cancelReason ? " " + booking.cancelReason : ""} The room is free for anyone to book.
        </div>
      ) : null}

      {displaced ? (
        <div className="mb-4 rounded border border-pending-line bg-pending-soft px-3 py-2.5 text-[13px]">
          <strong className="font-semibold">This session needs a new room.</strong>{" "}
          {booking.displacedReason || "The official timetable now needs the room this was booked in."}{" "}
          It has not been cancelled — pick another room with “Change room” below and it goes back on the
          board as normal.
        </div>
      ) : null}

      {awaitingApproval && !cancelled ? (
        <div className="mb-4 rounded-lg border border-moved-line bg-moved-soft px-3 py-2.5 text-[13px]">
          <strong className="font-semibold">Awaiting admin approval.</strong>{" "}
          {roomName(booking.roomId)} is held for these hours so nobody else can take it, but the session
          isn&apos;t confirmed yet.
          {isAdmin
            ? " Approve it below, or cancel it with a reason to turn it down."
            : " An admin will confirm it — you'll see it on the board either way."}
        </div>
      ) : null}

      {booking.movedFrom && !cancelled ? (
        <div className="mb-4 rounded-lg border border-moved-line bg-moved-soft px-3 py-2.5 text-[13px]">
          <strong className="font-semibold">Room changed.</strong> Moved here from {roomName(booking.movedFrom)}.
        </div>
      ) : null}

      {booking.seriesId ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
          <span className="pill">Repeating</span>
          {seriesLabelOf(booking)}
          {booking.seriesUntil ? " until " + shortDate(booking.seriesUntil) : ""}
          {seriesAheadCount > 0 ? " · " + seriesAheadCount + " more upcoming" : ""}
        </div>
      ) : null}

      <dl className="divide-y divide-line">
        <Row label="Room">
          <strong className="font-semibold">{room?.name || booking.roomId}</strong>
          {room?.note ? " — " + room.note : ""}
          {room ? <span className="text-muted"> · {room.capacity} seats</span> : null}
        </Row>
        <Row label="Time">
          <span className="font-mono tnum">
            {slotRange(booking.startSlot, booking.endSlot)} · {formatDuration(booking.startSlot, booking.endSlot)}
          </span>
        </Row>
        <Row label="Faculty">{booking.facultyName}</Row>
        <Row label="Years">
          {booking.years.length ? booking.years.map(yearLabel).join(" and ") : "Not specified"}
        </Row>
        <Row label="Batches">{batchNames(booking.batchIds)}</Row>
        {booking.note ? <Row label="Note">{booking.note}</Row> : null}
        <Row label="Booked">
          <span className="text-muted">
            {prettyDate(new Date(booking.createdAt).toISOString().slice(0, 10))} at {clockTime(booking.createdAt)}
          </span>
        </Row>
      </dl>

      {!canEdit && !cancelled ? (
        <p className="mt-4 text-[13px] text-muted">
          {profile?.role === "student"
            ? "Check the board before you set off — if the room changes you will see it here."
            : "Only " + booking.facultyName + " or an admin can change this booking."}
        </p>
      ) : null}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-baseline gap-3.5 py-2.5 text-[13.5px]">
      <dt className="label-xs">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
