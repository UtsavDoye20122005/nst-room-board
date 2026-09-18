# Practice run: the invigilation system

Twenty minutes, three teachers, nothing real touched. Everything here can be
undone at the end.

Three practice accounts, nobody real:

| Who | Sign in with ID | Password |
|---|---|---|
| Lakshita | `lakshita.bhargava` | (the one you set) |
| Shubham | `shubham.sagar` | `shubham@123` |
| Abhishek | `abhishek.sharma` | `abhishek@123` |

Three is the smallest number that tests everything: two can pair up and one is
left over to take a dropped duty.

If Abhishek does not exist yet, make him once:

```bash
npm run create-teacher-login -- abhishek.sharma "abhishek@123" "Abhishek Sharma"
```

No mass import. If you import the staff sheet, every real teacher lands in the
draw and in the live database, so leave it alone until the practice is done.

---

## 0. Publish the rules first

The pair lock lives in `firestore.rules`, not only in the screen, so the rules
have to be republished after the last change.

1. <https://console.firebase.google.com> → project **nst-room-board**
2. **Build → Firestore Database → Rules**
3. Open `firestore.rules` in VS Code, select all, copy
4. Paste over everything in the console editor, **Publish**

If you skip this, the Exams and My invigilation screens show red
"Missing or insufficient permissions" boxes and stay empty.

Then:

```bash
npm run dev
```

## 1. Clear out the old practice data

Sign in as admin.

- **Exams → Exam days**: click each test day → **Delete this exam day**. That
  removes the day and every duty under it, so the counts go back to zero.
- **Exams → Teachers**: anybody left over from earlier tests → **Remove**.
- **Exams → Log**: the event list stays. That is on purpose — it is the record
  of what happened. The per-teacher table above it is worked out from duties,
  so it empties by itself once the days are gone.

**Check:** Teachers tab shows only Lakshita, Shubham and Abhishek, all at
0 duties.

If anyone is missing, add them by hand: **Teachers → Add a teacher**, name plus
`<id>@nst-room-board.internal`. The email has to match the login exactly, or
the teacher signs in and sees no duty.

## 2. One exam day

**Exams → Exam days → New.**

- Date: the coming Friday
- Time: 09:00 to 12:00 (already filled in)
- Rooms: tick **three** rooms, one invigilator each — type `1` in the box if it
  suggests more.
- Standby: `0`
- **Create**

**Check:** each room card shows one name, and all three names are different.
Seats needed, Assigned and Spare teachers add up (3 teachers, 3 assigned,
0 spare).

If two landed in the same room, use **Move…** to put them apart — step 3 only
works when they start in different rooms.

## 3. Shubham asks Lakshita

Open a **private window** and sign in as Shubham. Keep the admin signed in in
the normal window, so you can watch both sides at once.

- **My invigilation** shows one card: his room, Friday, 09:00–12:00.
- **With you in this room:** Nobody else.
- **Ask to be with somebody:** pick *lakshita mam — C-1* → **Ask**.

**Check:** the dropdown is replaced by "Waiting for lakshita mam to accept",
with a Cancel link.

## 4. Lakshita accepts

Sign in as Lakshita in the normal window (or a second private window).

- A box at the top: **Somebody wants to be with you** — "Shubham Sagar wants to
  invigilate with you on Friday … (C-1)".
- **Yes, same room.**

**Check, straight away, without refreshing:**

- Shubham's card moves to C-1 and now reads **Fixed pair** — "You and lakshita
  mam are set for this room."
- The partner dropdown is gone on **both** sides.
- **I can't do this one** is gone on both sides. A fixed pair cannot be dropped
  by the teacher.
- On the admin screen, C-1 shows both names, each with a **paired with …**
  pill. Shubham's old room is empty.
- Abhishek, alone in the third room, now reads "Everybody else on duty has
  already fixed their pair."

## 5. The admin can still move them

Still the admin: click the **paired with** pill on either name.

**Check:** the pill disappears, both teachers get their Ask dropdown and their
"I can't do this one" button back. Click **Move…** to put one back in the empty
room.

This is the rule you asked for: once they agree the teachers are stuck with it,
and only the exam office can undo it.

## 6. Drawing again: do it together?

Open the exam day → **Draw again**. Every teacher on that day now gets one
question before any list of names appears.

**Drawn into a room with somebody** (the usual case when a day has one room and
two invigilators):

> **Do it together?**
> You have been put in C-1 with lakshita mam. Happy to invigilate together?
> [ Yes, ask lakshita ] [ No, somebody else ]

**Drawn on your own, but last time's partner is on duty in another room:**

> You invigilated with lakshita mam on Friday, 18 September, and they are on
> duty again in C-2. Happy to invigilate together?

In both cases **Yes** sends that person a request — they say yes at the top of
their own page and the pair is fixed. **No** drops the question and shows a
list of everybody else who could take the place, in two groups:

- **On duty in another room** — the two teachers settle it between themselves.
  One asks, the other accepts, done.
- **Free that day** (the spares, including whoever is on standby) — taking one
  of them means a colleague loses their duty, which is not a teacher's call. So
  it goes to the exam office as a **Partner change request**, and the admin sees
  it on the exam day with **Leave it** / **Swap them**.

If neither group has anybody, the exam office is simply told.

Either teacher can answer first; whoever says yes first does the asking.

**Check:**

- Both teachers get the question, not just one.
- After both say yes, the card reads **Fixed pair** and "I can't do this one"
  disappears on both sides.
- A "No" survives a refresh, but comes back as a fresh question the next time
  the admin draws.
- With only one room on the day, "No" leaves nobody to swap with, and the box
  says so instead of showing an empty dropdown.
- It still works after you delete the old exam day: who you were paired with is
  written onto the new duty the moment it is drawn, not looked up afterwards.

## 7. Dropping a duty

Unlock the pair first (step 5), then as Shubham → **I can't do this one** →
type a reason → **Drop this duty**.

- More than 24 hours before 09:00: it goes through at once. Abhishek is the
  only teacher not on duty in that room, so he is drawn in and Shubham's room
  now shows his name.
- Less than 24 hours before: it turns into a request. The admin sees it in the
  Log tab and approves or refuses it.

To test the second case without waiting, make an exam day for **today** and try
it there.

## 8. Attendance and the two PDFs

Make an exam day for **today** so the attendance buttons appear.

- Teacher side: **I'm here** appears only during the marking window — from the
  exam's start time until 30 minutes later (09:00 to 09:30 for a normal paper).
  Before that the card says when it opens; after it closes the button is gone
  and the card says to ask the exam office. Inside the window, tapping again
  undoes it.
- **Move…** on a name puts that teacher in a different room on the same exam
  day. With one room on the day there is nowhere to go, so it is greyed out.
- Admin side: **Present** / **Absent** on each name, the current one filled in.
  Clicking the filled one clears it back to unmarked. **Absent** is admin-only —
  a teacher cannot mark themselves, or anybody else, absent.
- Each room shows "1 of 2 marked" and an **All present** button, for the normal
  case where everybody turned up.
- **Exams → Exam days → Download attendance sheet**: rooms in order, a tick box
  and a signature line per teacher, already ticked for whoever marked
  themselves present, "absent" written next to anyone the admin marked absent.
- **Exams → Log → Download PDF**: every teacher, how many invigilations they
  have done, how many they dropped, their last duty, then each duty listed
  under their name.

### How attendance actually works

Every duty is one document. Marking attendance writes three fields on it:
`present` (true / false / nothing yet), `markedAt` (the time) and `markedBy`
(the name of whoever pressed the button). Nothing is counted or copied
anywhere else, so there is one record and it cannot disagree with itself.

Three things are enforced in `firestore.rules`, not just hidden in the screen:
a teacher may only write those fields on their **own** duty; only as *present*
(clearing it is fine, marking *absent* is not — that is the exam office's word);
and only between the exam's start time and 30 minutes later. The duty carries a
`startsAt` stamp written when it is drawn, which is what makes that last check
possible. An admin may mark anybody, present or absent, at any time.

`present` starts as nothing at all, which is different from `false`. Nothing
means "not marked yet"; `false` means "somebody said this teacher did not turn
up". The PDF prints an empty box for the first and "absent" for the second, so
an unmarked exam never looks like everybody was absent.

## 9. Clean up

- Delete the practice exam days (step 1).
- Leave the three practice teachers in the list, or remove them.

The counts are worked out from the duties every time the screen loads, so
deleting the days resets everything. There are no stored counters to go wrong.

---

## What is known to work

Everything above has been walked through in code and the types compile clean.
The draw, the pair lock, the skip rules, both PDFs and the live updates between
two windows are all wired.

## What the rules stop, even outside the app

The screen is a convenience; these are enforced in `firestore.rules`, so they
hold whether somebody uses the app, the browser console, or a script:

- A teacher may write attendance only on **their own** duty, only as *present*,
  only during the exam's first 30 minutes, and never over an *absent* the exam
  office recorded.
- A teacher may edit only their own duty, the duty of somebody who asked *them*
  to pair, and the room of a colleague sitting in the same room (the swap that
  accepting a partner needs). Nothing else.
- Dropping a duty yourself only works more than 24 hours out. Nearer than that
  the status a teacher can write is *requested*, and only an admin can approve.
- A teacher can create a duty only as a hand-over: right id, real exam day, not
  in the past, no attendance on it, no pair, not already dropped.
- A log line must be signed by whoever writes it, and can never be edited or
  deleted.
- Deleting anything is admin-only.

## Edge cases, and what happens in each

**Handled, worth trying once:**

| Situation | What happens |
|---|---|
| Two teachers ask the same person | Both requests show up. Accepting one fixes that pair; the other asker sees "waiting" until they press Cancel, and the accepter gets a **Clear** button on the leftover request. |
| The person you asked drops their duty first | Their duty is gone from the list, so nothing can be accepted. Cancel and ask somebody else. |
| A pair is fixed and one of them has to go | Neither teacher can drop it. The admin clicks the **paired with** pill to unlock, then Move or the teacher drops it. |
| Somebody drops and nobody is free | The room is left empty and the message says so. The admin sees the gap on the room card and can add a teacher by hand. |
| A teacher is on the list but has no login | They simply never see the page. The duty still exists and shows on the admin screen and in the PDF. |
| A teacher has a login but is not on the invigilator list | They see "No invigilation coming up". Add them under Teachers with the exact same email. |
| The admin removes a teacher who already has duties | Their history stays in the log and in the PDF — the table is built from duties, not from the teacher list. |
| A teacher is renamed | Old duties keep the old name, which is correct: that is who actually sat in the room that day. |
| The same teacher in two rooms on one day | Impossible. A duty is stored as `date + email`, so one teacher gets at most one duty per day. |
| A teacher tries to mark a colleague present | Refused by the database, not just hidden in the screen. Only the teacher themselves, or an admin, can write those fields. |
| Nobody marks attendance at all | The boxes print empty. An unmarked exam never reads as everybody absent. |
| A teacher says "No, somebody else" to the repeat question | The question goes for this exam only. The next draw asks again. |
| One says yes to the repeat, the other says no | The yes becomes an ordinary request; the other can still refuse it at the top of their page. Nothing is forced. |
| Two ex-partners are drawn into the same room anyway | No question is asked — they are already together. |
| A teacher asks for a spare instead of their roommate | The admin gets a Partner change request. **Swap them** puts the spare in and takes the named colleague off, in one write, so the room is never left short. |
| A teacher has a drop request pending | The pairing question and the partner list are hidden until the exam office answers — there is nothing to settle yet. |
| One room only, so **Move…** has nowhere to go | The dropdown is greyed out and says so on hover, instead of opening empty. |
| The exam day is deleted while a teacher is looking at it | Their card disappears within a second and the page says there is nothing coming up. |

**Known gaps, decide later:**

- **Replacement may have a class.** When a duty is dropped, the stand-in is
  picked from teachers with no duty that day, but their own timetable is not
  checked. The first draw does check it. In practice exams replace classes, so
  this rarely bites — but the admin should glance at the room card.
- **One exam slot per day.** Morning and afternoon papers on the same day
  cannot both have duties, because of the one-duty-per-teacher-per-day rule.
- **The 24-hour line uses the browser's clock.** A teacher with a wrong clock
  could get the free drop a few minutes early or late.
- **No email or notification.** A teacher finds out about a duty, or a partner
  request, by opening the page.
- **Attendance can be marked any time on the day**, not only between 09:00 and
  12:00.
- **Everything is read in one go.** Every duty document is loaded to work out
  the counts. Fine for a term or two, would need paging after a few years.
- Two admins editing the same exam day in the same second is untested.
- Phone screens narrower than about 360px are untested.
