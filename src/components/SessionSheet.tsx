"use client";

// ============================================================
//  Session details, plus everything a teacher can do to it:
//  change the room, cancel it, put it back, remove it.
//
//  Each action runs as a transaction and then offers to email
//  the affected batches.
// ============================================================

import { useState } from "react";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import {
  BookingConflict,
  cancelBooking,
  cancelSeriesFromDate,
  deleteBooking,
  moveBooking,
  reinstateBooking,
} from "@/lib/db";
import { notifyStudents } from "@/lib/notify";
import { clockTime, prettyDate, shortDate, weekdayName } from "@/lib/dates";
import { formatDuration, slotRange } from "@/lib/slots";
import { yearLabel } from "@/lib/seedData";
import type { Booking } from "@/lib/types";
import { Modal } from "./Modal";
import { useToast } from "./Toast";

type Pane = "detail" | "move" | "cancel";

export function SessionSheet({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { profile } = useAuth();
  const { roomById, roomName, batchNames, occupant, rooms, bookings } = useCampus();
  const { push } = useToast();

  const [pane, setPane] = useState<Pane>("detail");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [toRoom, setToRoom] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cancelWholeSeries, setCancelWholeSeries] = useState(false);

  const room = roomById(booking.roomId);
  const isOwner = profile?.uid === booking.facultyUid;
  const isAdmin = profile?.role === "admin";
  const canEdit = Boolean(profile && (profile.role === "faculty" || isAdmin) && (isOwner || isAdmin));
  const cancelled = booking.status === "cancelled";

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
                  if (sendEmail) {
                    const res = await notifyStudents(booking.id, "moved");
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
        {err ? <div className="mb-4 rounded border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div> : null}

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

        <label className="mt-4 flex cursor-pointer items-start gap-2.5">
          <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          <span className="text-[13.5px]">Email {batchNames(booking.batchIds)} about the change</span>
        </label>
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
                    if (sendEmail) {
                      const res = await notifyStudents(booking.id, "cancelled", reason.trim());
                      push(res.message, res.ok ? "info" : "bad");
                    }
                  } else {
                    await cancelBooking(booking, roomName(booking.roomId), reason.trim(), profile!.uid, profile!.name);
                    push("This week cancelled" + (isSeries ? " — the rest of the series is untouched" : ""));
                    if (sendEmail) {
                      const res = await notifyStudents(booking.id, "cancelled", reason.trim());
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
        {err ? <div className="mb-4 rounded border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div> : null}

        {isSeries ? (
          <div className="mb-4 space-y-2">
            <span className="label-xs">This is part of a weekly series</span>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line-strong bg-surface p-3">
              <input
                type="radio"
                className="mt-0.5 accent-[var(--accent)]"
                checked={!cancelWholeSeries}
                onChange={() => setCancelWholeSeries(false)}
              />
              <span className="text-[13.5px]">
                Just this week ({shortDate(booking.date)})
                <span className="mt-0.5 block text-[12px] text-muted">
                  The other {seriesAheadCount} upcoming week{seriesAheadCount === 1 ? "" : "s"} stay booked.
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
                This and every future {weekdayName(booking.date)}
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

        <label className="mt-4 flex cursor-pointer items-start gap-2.5">
          <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          <span className="text-[13.5px]">Email {batchNames(booking.batchIds)} about the cancellation</span>
        </label>
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

          <button className="btn" onClick={onClose} disabled={busy}>Close</button>

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
              <button className="btn" onClick={() => setPane("move")}>Change room</button>
              <button className="btn btn-danger" onClick={() => setPane("cancel")}>Cancel session</button>
            </>
          ) : null}
        </>
      }
    >
      {err ? <div className="mb-4 rounded border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div> : null}

      {cancelled ? (
        <div className="mb-4 rounded border border-off-line bg-off-soft px-3 py-2.5 text-[13px]">
          <strong className="font-semibold">This session is cancelled.</strong>
          {booking.cancelReason ? " " + booking.cancelReason : ""} The room is free for anyone to book.
        </div>
      ) : null}

      {booking.movedFrom && !cancelled ? (
        <div className="mb-4 rounded border border-moved-line bg-moved-soft px-3 py-2.5 text-[13px]">
          <strong className="font-semibold">Room changed.</strong> Moved here from {roomName(booking.movedFrom)}.
        </div>
      ) : null}

      {booking.seriesId ? (
        <div className="mb-4 flex items-center gap-2 rounded border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
          <span className="pill">Weekly series</span>
          Every {weekdayName(booking.date)}
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
            ? "Check the board before you set off — if the room changes you will see it here and get an email."
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
