"use client";

// ============================================================
//  One live picture of the campus, shared by every page.
//
//  Rooms, batches, people, bookings and notices are all watched
//  with Firestore onSnapshot, so when a teacher on another laptop
//  books C-6, this browser updates within a second. Nobody has to
//  refresh.
// ============================================================

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./authContext";
import {
  subscribeBatches,
  subscribeBookingsInRange,
  subscribeNotices,
  subscribeRooms,
  subscribeUsers,
} from "./db";
import { todayISO } from "./dates";
import type { Batch, Booking, Notice, Room, SlotLock, UserProfile } from "./types";

interface CampusState {
  loading: boolean;
  error: string | null;
  rooms: Room[];
  batches: Batch[];
  users: UserProfile[];
  bookings: Booking[];
  notices: Notice[];
  roomById: (id: string) => Room | undefined;
  roomName: (id: string) => string;
  batchById: (id: string) => Batch | undefined;
  batchNames: (ids: string[]) => string;
  /** Confirmed bookings on a date, in board order. */
  bookingsOn: (date: string) => Booking[];
  /** The confirmed booking occupying a room-hour, if any. */
  occupant: (date: string, roomId: string, slot: number) => Booking | undefined;
  /** Every booking touching a room-hour, cancelled ones included. */
  anyAt: (date: string, roomId: string, slot: number) => Booking | undefined;
  /** Total seats a set of batches needs. */
  strengthOf: (batchIds: string[]) => number;
  /**
   * Which date range `bookings` above actually covers. Whichever page
   * is open asks for the window IT needs (Board: one day, Calendar:
   * one month, admin Timetable: the next couple of weeks) instead of
   * one subscription loading the whole year for every viewer on every
   * page - that "load everything, always" approach is what burned
   * through Firestore's free daily quota on an ordinary day once real
   * people started using this. Defaults to just today until a page
   * asks for something wider.
   */
  setBookingsWindow: (fromDate: string, toDate: string) => void;
}

const Ctx = createContext<CampusState | null>(null);

export function CampusProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, configured } = useAuth();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState({ rooms: false, batches: false, bookings: false });
  const [bookingsWindow, setBookingsWindow] = useState(() => ({ from: todayISO(), to: todayISO() }));

  // Rooms, batches, bookings and notices only need a signed-in college
  // email (that's all firestore.rules asks for) - NOT a finished profile.
  // The onboarding screen itself needs the batch list before a profile
  // exists yet, so gating this behind `profile` would leave that screen's
  // batch picker permanently empty. Only the people list is staff-gated.
  const active = configured && Boolean(user);
  const isStaff = profile?.role === "faculty" || profile?.role === "admin";

  useEffect(() => {
    if (!active) return;
    const onErr = (label: string) => (e: Error) => {
      // A permission error here almost always means firestore.rules
      // has not been deployed, or the email domain list does not
      // include this person. Say so instead of showing a blank page.
      setError(
        "Could not load " + label + ": " + e.message +
        (e.message.toLowerCase().includes("permission")
          ? " — check that firestore.rules is deployed and that your email domain is listed in it."
          : "")
      );
    };

    const unsubs = [
      subscribeRooms((r) => { setRooms(r); setLoaded((s) => ({ ...s, rooms: true })); }, onErr("rooms")),
      subscribeBatches((b) => { setBatches(b); setLoaded((s) => ({ ...s, batches: true })); }, onErr("batches")),
      subscribeBookingsInRange(
        bookingsWindow.from,
        bookingsWindow.to,
        (b) => { setBookings(b); setLoaded((s) => ({ ...s, bookings: true })); },
        onErr("the schedule")
      ),
      subscribeNotices(setNotices, onErr("notices")),
    ];
    if (isStaff) unsubs.push(subscribeUsers(setUsers, onErr("people")));
    return () => unsubs.forEach((u) => u());
  }, [active, isStaff, bookingsWindow.from, bookingsWindow.to]);

  const value = useMemo<CampusState>(() => {
    const roomMap = new Map(rooms.map((r) => [r.id, r]));
    const batchMap = new Map(batches.map((b) => [b.id, b]));

    /** date|roomId|slot -> booking, for O(1) board lookups. */
    const confirmedIndex = new Map<string, Booking>();
    const anyIndex = new Map<string, Booking>();
    for (const b of bookings) {
      for (let s = b.startSlot; s <= b.endSlot; s++) {
        const key = b.date + "|" + b.roomId + "|" + s;
        if (b.status === "confirmed") confirmedIndex.set(key, b);
        if (!anyIndex.has(key) || b.status === "confirmed") anyIndex.set(key, b);
      }
    }

    return {
      loading: active && !(loaded.rooms && loaded.batches && loaded.bookings),
      error,
      rooms,
      batches,
      users,
      bookings,
      notices,
      roomById: (id) => roomMap.get(id),
      roomName: (id) => roomMap.get(id)?.name || id,
      batchById: (id) => batchMap.get(id),
      batchNames: (ids) =>
        (ids || []).map((i) => batchMap.get(i)?.name || i).join(", ") || "All batches",
      bookingsOn: (date) =>
        bookings
          .filter((b) => b.date === date)
          .sort(
            (a, b) =>
              a.startSlot - b.startSlot ||
              (roomMap.get(a.roomId)?.order ?? 99) - (roomMap.get(b.roomId)?.order ?? 99)
          ),
      occupant: (date, roomId, slot) => confirmedIndex.get(date + "|" + roomId + "|" + slot),
      anyAt: (date, roomId, slot) => anyIndex.get(date + "|" + roomId + "|" + slot),
      strengthOf: (ids) =>
        (ids || []).reduce((n, i) => n + (batchMap.get(i)?.strength || 0), 0),
      setBookingsWindow: (fromDate, toDate) =>
        setBookingsWindow((cur) => (cur.from === fromDate && cur.to === toDate ? cur : { from: fromDate, to: toDate })),
    };
  }, [rooms, batches, users, bookings, notices, error, active, loaded]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCampus(): CampusState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCampus must be used inside <CampusProvider>.");
  return v;
}

export type { SlotLock };
