# NST Room Board

Classroom and exam allocation for the NST campus. Teachers book a room for a
date and time, and nobody else can book that room for those hours. Students
open the same site and see exactly which room their class or exam is in.

Built with **Next.js 14**, **Firebase Auth**, **Cloud Firestore** and
**Tailwind CSS**. Everything used here is on a free plan — no credit card
is needed anywhere.

---

## What it does

**For teachers**

- A day board: hours down the side, rooms across the top. Green means free,
  red means taken. A taken hour shows the subject, a short description, the
  teacher's name and which batches are in there.
- Click a free hour to book it. Pick the type (class, lab, exam, event), the
  subject, a short description, and who is invited.
- Select a whole year in one tick, or individual batches.
- A warning when the batches selected will not fit the room's real capacity.
- Change the room or cancel a session at any time. Both are one click, and both
  can email the affected batches automatically.
- Cancelling frees the room immediately so another teacher can use it.

**For students**

- A "Go to C-6" card at the top of the board with their next class or exam.
- Their own schedule, filtered to their batch.
- Room changes and cancellations shown on the board and in Notices, and emailed.

**For an admin**

- Rooms and capacities, batch names and strengths, and everyone's role — all
  editable in the app. No code changes needed to run the next semester.

---

## How double booking is made impossible

This is the part your teacher will ask about, so it is worth understanding.

Every occupied hour gets its own small document in a `slotLocks` collection,
and its id is calculated, not random:

```
<date>_<roomId>_<slot>        e.g.  2026-09-07_c6_1
```

Booking C-6 from 09:30 to 11:30 therefore means creating
`2026-09-07_c6_1` and `2026-09-07_c6_2`.

All of that happens inside a **Firestore transaction** (`src/lib/db.ts`,
`createBooking`). The transaction reads those documents first. If any of them
already exists, the whole thing is thrown away and the teacher is told who
holds the room. If two teachers press Confirm in the same second, Firestore
serialises the two transactions: one succeeds, the other retries, sees the
lock and fails cleanly with a readable message.

There is no window in which both teachers can win. This is a real database
guarantee, not a UI check that could be raced.

---

## Getting it running

Full click-by-click walkthrough: **[docs/SETUP.md](docs/SETUP.md)**

The short version:

```bash
npm install
cp .env.local.example .env.local     # then fill it in
npm run dev                          # http://localhost:3000
```

Once you can sign in:

```bash
npm run seed                              # loads the rooms and batches
npm run make-admin you@newtonschool.co    # gives yourself admin
```

---

## Project layout

```
src/
  app/
    layout.tsx            fonts, providers
    page.tsx              front door - sends you to login / profile / board
    login/                Google sign-in and email + password
    onboarding/           first-login profile, and the Profile page after
    board/                THE DAY BOARD - the main screen
    calendar/             month view
    my/                   my bookings (faculty) / my schedule (student)
    notices/              room changes and cancellations
    admin/                rooms, batches, people
    api/notify/           server route that sends the emails
  components/
    BoardGrid.tsx         the rooms x hours table
    BookingModal.tsx      the booking form
    SessionSheet.tsx      details, change room, cancel, reinstate
    BatchPicker.tsx       year and batch selection
    AppShell.tsx          header, nav, auth guard
  lib/
    db.ts                 EVERY Firestore read and write, incl. the transaction
    types.ts              every data shape in one place
    slots.ts              the teaching day - edit this to change the timetable
    rooms/batches         seeded from src/data/campusSeed.json
    email.ts              the three email providers and the message templates
    authContext.tsx       sign-in and the current person's profile
    campusContext.tsx     one live picture of the campus, shared by all pages
firestore.rules           who is allowed to read and write what
scripts/seed.mjs          loads rooms and batches
scripts/make-admin.mjs    promotes someone to admin
```

---

## Things you will want to change

| To change | Edit |
|---|---|
| The hours of the teaching day | `src/lib/slots.ts` |
| Room names and capacities | Admin → Rooms in the app, or `src/data/campusSeed.json` before seeding |
| Batch names | Admin → Batches in the app |
| Which email domains can sign in | `.env.local` **and** `firestore.rules` — both places |
| Years offered (adding 3rd year) | `YEARS` in `src/lib/seedData.ts` |
| Subject suggestions | `src/data/campusSeed.json` |
| Email wording | `buildEmail()` in `src/lib/email.ts` |
| Colours and fonts | the token block at the top of `src/app/globals.css` |

Rooms and batches are stored in the database, not in the code, so the seed
file only matters the first time.

---

## Current limits, stated honestly

- **Email reaches students who have signed in at least once**, because that is
  how the app learns their address. For anyone who has not, an admin can paste
  addresses into Admin → Batches → Emails and they get copied on every notice.
- **Gmail sending is capped** at roughly 500 recipients a day. Brevo's free
  tier is 300 a day. Either is plenty for a campus; neither is a mailing list.
- **No recurring bookings yet.** A weekly class has to be booked per week.
  This is the most useful next feature.
- **No seating plan** for exams — the board allocates rooms, not desks.

---

## Invigilation duty

Exams need teachers watching the room, and picking them by hand ends with
the same three people every Friday. Room Board draws them instead.

**Admin → Exams**

- **Exam days.** A date, a time, and the rooms being used. Each room carries
  how many invigilators it needs — suggested as one per 40 seats, and you can
  change any number.
- **Assign invigilators.** One press draws the duties. A teacher who already
  has a class or lab booked in those hours is left out of the draw, because
  the board already knows their timetable.
- Each room shows who is on it. You can move somebody to another room, add a
  teacher by hand, take one off, and mark who turned up.
- **Attendance PDF** prints one sheet: every room, every name, a box to tick
  and a line to sign.
- **Teachers** lists everyone with their duty count, their skips and their
  last duty. Green means below average, amber above.
- **Log** is the admin-only trail: every draw, skip, swap and move, with who
  did it and when.

**A teacher → My invigilation**

- Their next duty: room, date, time, and who else is in that room.
- **"I can't do this one."** More than 24 hours before the exam, the duty is
  handed straight to the freest teacher who has nothing on. Inside 24 hours it
  becomes a request for the admin to approve.
- **Ask to be with somebody.** The other teacher has to say yes. When they do,
  the two swap rooms so both are together and every room keeps the number of
  invigilators the admin set.
- **"I'm here"** on the exam day, with a timestamp.

### Trying it out

`npm run seed-invigilators` adds ten practice teachers (all on
`@practice.invalid`), so the draw can be tested without touching real staff.
`npm run seed-invigilators clear` removes them again. A step-by-step run
through every part is in [docs/TESTING-INVIGILATION.md](docs/TESTING-INVIGILATION.md).

### How the draw stays fair

Pure random gives one teacher six duties in a term and another one. So each
teacher's chance is weighted:

```
weight = (busiest teacher's duty count + 1) - this teacher's duty count
```

The teacher with the fewest duties has the biggest ticket in the draw, and the
busiest still has one, so it never becomes a fixed rota. Over a term everyone
lands within a duty or two of everyone else.

### Where the data lives

| Collection | What it holds | Who can read it |
|---|---|---|
| `invigilators` | one per teacher: name, email, duty and skip counters | staff |
| `examDays` | date, time, rooms, invigilators needed per room | staff |
| `duties` | one per teacher per exam day: room, skip, partner, attendance | staff |
| `invigLog` | every action, append only | admin only |

`duties` is a top-level collection with the id `<date>__<email>`. That id makes
a double assignment impossible, and it means both questions the app asks — "my
duties" and "every duty on Friday" — are single-field queries that need no
Firestore index.

After pulling these changes, publish the rules once:

```bash
firebase deploy --only firestore:rules
```

### The seating chart

Seating is a separate app (`nst-exam-seating`), because the seat-by-seat
shuffling has nothing to do with rooms and bookings. The two are stitched
together with links that carry the room across:

- Admin → Exams: "Seating chart ↗" at the top, and a small "seating ↗" on every
  room card that opens the sheet **on that room**.
- A teacher's duty card: "Seating for C-6 ↗", so the invigilator lands on the
  room they are standing in.
- An exam on the day board: "Seating chart ↗" inside the session.

The link looks like `…/?room=C-6&date=2026-09-19`. The seating sheet knows that
`C-6` and `Classroom 6` are the same room, shows only that room, and offers a
"Show every room" button.

`src/lib/links.ts` is the only file that knows the address. Set
`NEXT_PUBLIC_SEATING_URL` in `.env.local` (and in Vercel) if the seating app
ever moves.
