"use client";

// ============================================================
//  What a teacher sees: my invigilation.
//
//  Their next duty, who else is in that room, a way to drop out,
//  a way to ask a colleague to be in the same room, and the
//  "I'm here" button on the day itself.
// ============================================================

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/authContext";
import { prettyDate, relativeDay, todayISO } from "@/lib/dates";
import { SLOTS, slotRange } from "@/lib/slots";
import {
  acceptPartner,
  canSkipFreely,
  attendanceWindow,
  ATTENDANCE_WINDOW_MINUTES,
  cleanEmail,
  declinePartner,
  declineRepeat,
  requestSwapIn,
  cancelSwapIn,
  markAttendance,
  requestPartner,
  skipDuty,
  subscribeDutiesFor,
  subscribeDutiesOn,
  subscribeAllDuties,
  subscribeInvigilators,
  subscribePartnerRequests,
  tallyDuties,
  EMPTY_TALLY,
  SKIP_FREE_HOURS,
  type PoolMember,
  type Tally,
} from "@/lib/invigilation";
import type { Duty, Invigilator } from "@/lib/types";

export default function InvigilationPage() {
  return (
    <AppShell>
      <Body />
    </AppShell>
  );
}

function Body() {
  const { profile } = useAuth();
  const { push } = useToast();
  const email = cleanEmail(profile?.email || "");
  const me = { email, name: profile?.name || email };

  const [mine, setMine] = useState<Duty[]>([]);
  const [requests, setRequests] = useState<Duty[]>([]);
  const [invigilators, setInvigilators] = useState<Invigilator[]>([]);
  const [allDuties, setAllDuties] = useState<Duty[]>([]);

  useEffect(() => {
    if (!email) return;
    return subscribeDutiesFor(email, setMine, (e) => push(e.message, "bad"));
  }, [email, push]);

  useEffect(() => {
    if (!email) return;
    return subscribePartnerRequests(email, setRequests, (e) => push(e.message, "bad"));
  }, [email, push]);

  useEffect(() => subscribeInvigilators(setInvigilators, () => {}), []);
  useEffect(() => subscribeAllDuties(setAllDuties, () => {}), []);

  const today = todayISO();
  const upcoming = mine.filter((d) => d.date >= today && d.status !== "skipped").sort((a, b) => a.date.localeCompare(b.date));
  const past = mine.filter((d) => d.date < today || d.status === "skipped");
  const next = upcoming[0] || null;

  const doneCount = mine.filter((d) => d.status !== "skipped").length;
  const tally = tallyDuties(allDuties);

  if (!profile) return null;
  if (profile.role === "student") {
    return (
      <div className="card p-6">
        <h1 className="text-xl font-semibold">Invigilation is for teachers</h1>
        <p className="mt-2 text-ink-2">Your exam room is on the day board.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold">My invigilation</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          You have done <strong className="text-ink">{doneCount}</strong>{" "}
          {doneCount === 1 ? "duty" : "duties"}.
        </p>
      </div>

      {requests.length > 0 ? (
        <div className="card border-accent-line p-4">
          <div className="label-xs text-accent">Somebody wants to be with you</div>
          <ul className="mt-2 grid gap-2">
            {requests.map((asker) => (
              <PartnerRequest key={asker.id} asker={asker} mine={mine} me={me} />
            ))}
          </ul>
        </div>
      ) : null}

      {next ? (
        <DutyCard duty={next} me={me} invigilators={invigilators} tally={tally} isNext />
      ) : (
        <div className="card p-6">
          <h2 className="text-lg font-semibold">No invigilation coming up</h2>
          <p className="mt-2 text-[13.5px] text-ink-2">
            When the exam office draws the duties for the next exam, it will show up here, and you will see the room and
            the time.
          </p>
        </div>
      )}

      {upcoming.slice(1).map((d) => (
        <DutyCard key={d.id} duty={d} me={me} invigilators={invigilators} tally={tally} />
      ))}

      {past.length > 0 ? (
        <div className="card p-4">
          <div className="label-xs">Earlier</div>
          <ul className="mt-2 grid gap-1.5 text-[13.5px]">
            {past.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12.5px] text-muted tnum">{prettyDate(d.date)}</span>
                <span>{d.roomName}</span>
                {d.status === "skipped" ? <span className="pill text-busy">dropped</span> : null}
                {d.present === true ? <span className="pill text-free">present</span> : null}
                {d.present === false ? <span className="pill text-busy">absent</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DutyCard({
  duty,
  me,
  invigilators,
  tally,
  isNext,
}: {
  duty: Duty;
  me: { email: string; name: string };
  invigilators: Invigilator[];
  tally: Map<string, Tally>;
  isNext?: boolean;
}) {
  const { push } = useToast();
  const [sameDay, setSameDay] = useState<Duty[]>([]);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [partner, setPartner] = useState("");

  useEffect(() => subscribeDutiesOn(duty.date, setSameDay, () => {}), [duty.date]);

  const startsAt = startMs(duty.date, duty.startSlot);
  const free = canSkipFreely(duty, startsAt);
  const isToday = duty.date === todayISO();

  // "I'm here" only means something while the exam is actually
  // starting, so the button lives for half an hour from 09:00. A tick
  // every minute keeps the card honest without a refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [isToday]);
  const window_ = attendanceWindow(duty, now);
  const onDutyToday = sameDay.filter((d) => d.email !== duty.email && d.status !== "skipped");
  const inMyRoom = onDutyToday.filter((d) => d.roomId === duty.roomId);
  // Only somebody in a different room is worth asking - being with
  // the people already next to you is not a request.
  const others = onDutyToday.filter((d) => d.roomId !== duty.roomId && !d.partnerLocked);
  const locked = duty.partnerLocked === true;

  // After a draw, every teacher gets ONE question before being shown a
  // list of names.
  //
  //  - Put in a room with somebody? "Do it together?" Yes fixes the
  //    pair (they have to say yes too), No opens the list.
  //  - On your own, but last time's partner is on duty in another
  //    room? "Same as last time?" - who that was is stamped on the
  //    duty when it is drawn, so it survives the old exam day being
  //    deleted or redrawn.
  //
  // Both teachers get the same question, so whoever opens the page
  // first does the asking and the other one accepts at the top of the
  // page.
  const previous = duty.lastPartnerEmail
    ? { email: duty.lastPartnerEmail, name: duty.lastPartnerName || duty.lastPartnerEmail, date: duty.lastPartnerDate }
    : null;
  const previousNow = previous ? onDutyToday.find((d) => d.email === previous.email) : undefined;
  const somebodyAskedMe = onDutyToday.some((d) => d.partnerRequestTo === duty.email);
  const droppingOut = duty.status === "skip-requested";
  const swapAsked = !!duty.swapWantEmail;
  const quiet =
    locked || droppingOut || swapAsked || !!duty.partnerRequestTo || duty.pairAgain === "no" || somebodyAskedMe;

  // Teachers with no duty at all that day - the spares. Asking for one
  // of them means a colleague loses their duty, so it goes to the exam
  // office rather than straight through.
  const takenToday = new Set(sameDay.filter((d) => d.status !== "skipped").map((d) => d.email));
  const spares = invigilators.filter((i) => i.active !== false && !takenToday.has(i.email) && i.email !== duty.email);
  const onlyRoommate = inMyRoom.length === 1 ? inMyRoom[0] : null;
  // Nobody to offer at all: no other room, and no spare we could ask
  // the office to swap in.
  const nothingToOffer = others.length === 0 && !(onlyRoommate && spares.length > 0);

  const roommate = inMyRoom.find((d) => d.partnerLocked !== true);
  const question: { who: { email: string; name: string }; text: string } | null = quiet
    ? null
    : roommate
    ? {
        who: roommate,
        text: "You have been put in " + duty.roomName + " with " + roommate.name + ".",
      }
    : previous && previousNow && previousNow.partnerLocked !== true
    ? {
        who: previous,
        text:
          "You invigilated with " +
          previous.name +
          (previous.date ? " on " + prettyDate(previous.date) : " last time") +
          ", and they are on duty again in " +
          previousNow.roomName +
          ".",
      }
    : null;

  // The list of names is the fallback: no question outstanding, and
  // somebody in another room actually free to ask.
  const canAsk =
    !locked &&
    !droppingOut &&
    !swapAsked &&
    !duty.partnerRequestTo &&
    !somebodyAskedMe &&
    !question &&
    (others.length > 0 || (spares.length > 0 && !!onlyRoommate));

  // Real counts, so whoever gets handed a dropped duty is the person
  // who has done the fewest - not just the first name that fits.
  const pool: PoolMember[] = invigilators
    .filter((i) => i.active !== false)
    .map((i) => ({ email: i.email, name: i.name, duties: (tally.get(i.email) || EMPTY_TALLY).duties }));

  async function doSkip() {
    if (!reason.trim()) {
      push("Write one line about why, so the office knows.", "bad");
      return;
    }
    try {
      const res = await skipDuty({
        duty,
        reason: reason.trim(),
        free,
        pool,
        takenEmails: sameDay.map((d) => d.email),
        by: me,
      });
      setAsking(false);
      setReason("");
      push(
        free
          ? res.replacedBy
            ? "Dropped. " + res.replacedBy + " has taken it."
            : "Dropped. Nobody was free, so the office will fill it."
          : "Sent to the exam office. They will decide."
      );
    } catch (e) {
      push((e as Error).message, "bad");
    }
  }

  return (
    <div className={"card p-5 " + (isNext ? "border-accent-line" : "")}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          {isNext ? <div className="label-xs text-accent">Next duty</div> : null}
          <h2 className="mt-1 text-xl font-semibold">{duty.roomName}</h2>
          <p className="mt-1 font-mono text-[13px] text-muted tnum">
            {prettyDate(duty.date)} · {slotRange(duty.startSlot, duty.endSlot)} · {relativeDay(duty.date)}
          </p>
          {duty.status === "skip-requested" ? (
            <p className="mt-2 text-[13px] text-pending">
              You asked to drop this one. Waiting for the exam office to decide.
            </p>
          ) : null}
        </div>
        {isToday && duty.status !== "skipped" ? (
          <div className="max-w-[15rem] text-right">
            {window_.open ? (
              <button
                className={"btn " + (duty.present === true ? "" : "btn-primary")}
                onClick={() =>
                  void markAttendance(duty, duty.present === true ? null : true, me).catch((e: Error) =>
                    push(e.message, "bad")
                  )
                }
              >
                {duty.present === true ? "You are marked present ✓" : "I'm here"}
              </button>
            ) : null}
            <p className={"text-[12px] " + (window_.open ? "mt-1 text-muted" : "text-muted")}>
              {duty.present === true
                ? "Present" +
                  (duty.markedAt ? ", marked at " + clockTime(duty.markedAt) : "") +
                  (window_.open ? ". Tap to undo." : ".")
                : duty.present === false
                ? "The exam office has you down as absent."
                : window_.early
                ? "You can mark yourself present from " +
                  clockTime(window_.opensAt) +
                  ", for " +
                  ATTENDANCE_WINDOW_MINUTES +
                  " minutes."
                : window_.open
                ? "Tap when you reach the room. This closes at " + clockTime(window_.closesAt) + "."
                : "Marking closed at " + clockTime(window_.closesAt) + ". Ask the exam office to mark you."}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="label-xs">With you in this room</div>
          <p className="mt-1 text-[13.5px]">
            {inMyRoom.length ? inMyRoom.map((d) => d.name).join(", ") : "Nobody else."}
          </p>
        </div>
        {locked ? (
          <div>
            <div className="label-xs">Fixed pair</div>
            <p className="mt-1 text-[13.5px]">
              You and <strong>{duty.partnerName}</strong> are set for this room. Nobody can change it now — ask the exam
              office if something has to move.
            </p>
          </div>
        ) : duty.partnerRequestTo ? (
          <div>
            <div className="label-xs">Asked</div>
            <p className="mt-1 text-[13.5px]">
              Waiting for{" "}
              <strong>{sameDay.find((d) => d.email === duty.partnerRequestTo)?.name || duty.partnerRequestTo}</strong>{" "}
              to accept.{" "}
              <button className="underline" onClick={() => void declinePartner(duty).catch((e: Error) => push(e.message, "bad"))}>
                Cancel
              </button>
            </p>
          </div>
        ) : question ? (
          <div>
            <div className="label-xs text-accent">Do it together?</div>
            <p className="mt-1 text-[13.5px]">{question.text} Happy to invigilate together?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="btn btn-primary"
                onClick={() =>
                  void requestPartner(duty, question.who.email).then(
                    () => push("Asked " + question.who.name + ". They have to say yes too."),
                    (e: Error) => push(e.message, "bad")
                  )
                }
              >
                Yes, ask {question.who.name.split(" ")[0]}
              </button>
              <button
                className="btn"
                onClick={() =>
                  void declineRepeat(duty, { alone: nothingToOffer, by: me }).then(
                    () =>
                      push(
                        nothingToOffer
                          ? "Noted. There is nobody else free that day, so the exam office has been told."
                          : "Fine. Pick somebody else below."
                      ),
                    (e: Error) => push(e.message, "bad")
                  )
                }
              >
                No, somebody else
              </button>
            </div>
          </div>
        ) : swapAsked ? (
          <div>
            <div className="label-xs">Asked the exam office</div>
            <p className="mt-1 text-[13.5px]">
              You asked for <strong>{duty.swapWantName}</strong> instead of {duty.swapOutName}. The exam office will
              decide.{" "}
              <button
                className="underline"
                onClick={() => void cancelSwapIn(duty).catch((e: Error) => push(e.message, "bad"))}
              >
                Cancel
              </button>
            </p>
          </div>
        ) : canAsk ? (
          <div>
            <div className="label-xs">Who would you rather have?</div>
            <div className="mt-1 flex gap-2">
              <select className="input" value={partner} onChange={(e) => setPartner(e.target.value)}>
                <option value="">Choose a teacher…</option>
                {others.length ? (
                  <optgroup label="On duty in another room — you two can agree it yourselves">
                    {others.map((d) => (
                      <option key={d.email} value={d.email}>
                        {d.name} — {d.roomName}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {onlyRoommate && spares.length ? (
                  <optgroup label={"Free that day — the exam office has to swap " + onlyRoommate.name + " out"}>
                    {spares.map((i) => (
                      <option key={i.email} value={"spare:" + i.email}>
                        {i.name} — not on duty
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <button
                className="btn"
                disabled={!partner}
                onClick={() => {
                  if (partner.startsWith("spare:")) {
                    const want = spares.find((i) => i.email === partner.slice(6));
                    if (!want || !onlyRoommate) return;
                    void requestSwapIn({
                      duty,
                      want: { email: want.email, name: want.name },
                      out: { email: onlyRoommate.email, name: onlyRoommate.name },
                      by: me,
                    }).then(
                      () => {
                        setPartner("");
                        push("Asked the exam office for " + want.name + ".");
                      },
                      (e: Error) => push(e.message, "bad")
                    );
                    return;
                  }
                  void requestPartner(duty, partner).then(
                    () => {
                      setPartner("");
                      push("Asked. They will get it on their own page.");
                    },
                    (e: Error) => push(e.message, "bad")
                  );
                }}
              >
                Ask
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="label-xs">Partner</div>
            <p className="mt-1 text-[13.5px] text-ink-2">
              {somebodyAskedMe
                ? "Somebody has asked to be with you — the answer is at the top of this page."
                : onDutyToday.length === 0
                ? "You are the only teacher on duty that day, so there is nobody to pair with."
                : droppingOut
                ? "Nothing to decide while your request to drop this duty is with the exam office."
                : duty.pairAgain === "no" && nothingToOffer
                ? "You asked for a different partner, but nobody else is free that day. The exam office has it on their list."
                : inMyRoom.length > 0
                ? "You are sharing " +
                  duty.roomName +
                  " with " +
                  inMyRoom.map((d) => d.name).join(" and ") +
                  ", and there is nobody in another room to swap with. Ask the exam office if that needs to change."
                : "Everybody else on duty has already fixed their pair. The exam office can still move people around."}
            </p>
          </div>
        )}
      </div>

      {duty.status === "assigned" && !locked ? (
        <div className="mt-4 border-t border-line pt-3">
          {!asking ? (
            <button className="btn btn-danger" onClick={() => setAsking(true)}>
              I can't do this one
            </button>
          ) : (
            <div className="grid gap-2">
              <p className="text-[13px] text-ink-2">
                {free
                  ? "Somebody free will be given this room straight away."
                  : "The exam is less than " + SKIP_FREE_HOURS + " hours away, so the exam office has to approve this."}
              </p>
              <input
                className="input"
                placeholder="Why? One line is enough."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button className="btn" onClick={() => setAsking(false)}>
                  Never mind
                </button>
                <button className="btn btn-danger" onClick={() => void doSkip()}>
                  {free ? "Drop this duty" : "Ask the office"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {locked ? (
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-muted">
          This duty is fixed because you agreed to a pair. The exam office can still move either of you.
        </p>
      ) : null}
    </div>
  );
}

function PartnerRequest({ asker, mine, me }: { asker: Duty; mine: Duty[]; me: { email: string; name: string } }) {
  const { push } = useToast();
  const [sameDay, setSameDay] = useState<Duty[]>([]);
  useEffect(() => subscribeDutiesOn(asker.date, setSameDay, () => {}), [asker.date]);
  const myDuty = mine.find((d) => d.date === asker.date && d.status !== "skipped");

  if (!myDuty) {
    return (
      <li className="text-[13.5px] text-muted">
        {asker.name} asked to be with you on {prettyDate(asker.date)}, but you have no duty that day.
      </li>
    );
  }

  if (myDuty.partnerLocked) {
    return (
      <li className="flex flex-wrap items-center gap-2 text-[13.5px]">
        <strong>{asker.name}</strong>
        <span className="text-muted">
          asked to be with you, but you are already fixed with {myDuty.partnerName}.
        </span>
        <button className="btn btn-sm ml-auto" onClick={() => void declinePartner(asker)}>
          Clear
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-2 text-[13.5px]">
      <strong>{asker.name}</strong>
      <span className="text-muted">
        wants to invigilate with you on {prettyDate(asker.date)} ({myDuty.roomName})
      </span>
      <span className="ml-auto flex gap-2">
        <button className="btn btn-sm" onClick={() => void declinePartner(asker).then(() => push("Said no."))}>
          No
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() =>
            void acceptPartner({
              asker,
              me: myDuty,
              othersInMyRoom: sameDay.filter((d) => d.roomId === myDuty.roomId),
              by: me,
            }).then(() => push("Done. You are both in " + myDuty.roomName + "."))
          }
        >
          Yes, same room
        </button>
      </span>
    </li>
  );
}

/** 09:04, in the teacher's own clock. */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** When the exam actually starts, in milliseconds. */
function startMs(date: string, slot: number): number {
  const s = SLOTS.find((x) => x.index === slot) || SLOTS[0];
  return new Date(date + "T" + s.start + ":00").getTime();
}
