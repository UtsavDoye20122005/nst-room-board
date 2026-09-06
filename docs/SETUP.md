# Setup, step by step

Everything here is free. No credit card is needed at any point.

Total time: about 30 minutes the first time.

Work through the parts in order. Each part ends with something you can check,
so you never get three steps past a mistake.

---

## Part 0 — What you need

- Node.js 18 or newer (`node -v` to check; download from nodejs.org)
- A Google account
- Your college email address

---

## Part 1 — Create the Firebase project

1. Go to **console.firebase.google.com** and sign in.
2. **Create a project**. Name it `nst-room-board`. Continue.
3. Google Analytics — **turn it off**. You do not need it. Create project.

### 1a. Add the web app

4. On the project home page, click the **web icon** (`</>`).
5. App nickname: `Room Board`. Do **not** tick Firebase Hosting. Register app.
6. Firebase now shows a `firebaseConfig` block. **Leave this tab open** — you
   need these six values in Part 3.

### 1b. Turn on sign-in

7. Left sidebar → **Build → Authentication → Get started**.
8. **Sign-in method** tab → **Google** → enable → pick a support email → Save.

> That's the only provider you need to switch on by hand. The other way
> in — email + a 6-digit verification code — uses Firebase's custom-token
> sign-in, which is always available and needs no toggle here. It's built
> from `firebase-admin` on the server (`/api/auth/request-code` and
> `/api/auth/verify-code`), the same way `/api/notify` sends booking
> emails, so it also needs the service-account values from Part 3 and a
> working `EMAIL_PROVIDER` (Part 7) before codes actually arrive.

### 1c. Create the database

10. Left sidebar → **Build → Firestore Database → Create database**.
11. Choose **Production mode**. (Test mode would leave your data open to
    anyone. The rules in Part 4 are what make it safe.)
12. Location: **asia-south1 (Mumbai)** — closest to you, so the board feels
    instant. This cannot be changed later.
13. Create.

**Check:** you should now see an empty Firestore with a Rules tab.

---

## Part 2 — Get the server key

The app needs a second, private credential so the server can send emails and
so the seed scripts can write to the database.

1. Click the **gear icon** (top of the sidebar) → **Project settings**.
2. **Service accounts** tab → **Generate new private key** → confirm.
3. A `.json` file downloads. Open it in a text editor. You need three fields
   from it: `project_id`, `client_email` and `private_key`.

> Never commit this file or paste it anywhere public. It is full admin access
> to your database. `.gitignore` already blocks `serviceAccount.json`.

---

## Part 3 — Fill in .env.local

In the project folder:

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill it in.

**From the `firebaseConfig` block in Part 1a:**

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=nst-room-board.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=nst-room-board
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=nst-room-board.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abc123
```

**Your college domains** — only these addresses can sign in:

```
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS=newtonschool.co,rishihood.edu.in
```

> Check what your own college email actually ends with and correct this.
> You must also put the same domains in `firestore.rules` — see Part 4.

**From the service-account JSON in Part 2:**

```
FIREBASE_PROJECT_ID=nst-room-board
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@nst-room-board.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvg...\n-----END PRIVATE KEY-----\n"
```

> The private key must stay **inside double quotes** and keep its `\n`
> sequences exactly as they appear in the JSON. This is the single most
> common thing people get wrong.

Leave the email section as `EMAIL_PROVIDER=console` for now. Part 7 turns
real email on.

---

## Part 4 — Publish the security rules

The rules decide who can read and write what. Without them, Firestore in
production mode blocks everything and the app will show a permission error.

1. Open `firestore.rules` in the project.
2. Find the `allowedDomain()` function near the top and make the two
   `matches(...)` lines use **your** real domains.
3. In the Firebase console: **Firestore Database → Rules** tab.
4. Delete what is there, paste the whole contents of `firestore.rules`,
   and click **Publish**.

**What the rules give you**

- Only your college domains can read anything at all.
- Only faculty and admins can book a room.
- A teacher can change or cancel **their own** bookings; an admin can change
  anyone's.
- Nobody can promote themselves to faculty or admin from the browser — only
  the `make-admin` script or an existing admin can do that.
- Students cannot read other students' profiles.
- Notices cannot be edited after the fact, only added and (by an admin) deleted.

---

## Part 5 — First run

```bash
npm install
npm run dev
```

Open **http://localhost:3000**.

1. Sign in with your college Google account.
2. Fill in the profile screen: choose **Faculty**, your name, the subjects
   you teach, and the years.
3. You land on the board — but with no rooms yet.

Stop the dev server (Ctrl+C) and load the campus data:

```bash
npm run seed
```

That writes the seven rooms with their real capacities (C-1 60, C-4 60,
C-5 60, C-6 114, C-8 130, ARVR Zone 35, Robo Lab 30) and six placeholder
batches.

Now make yourself an admin:

```bash
npm run make-admin your.email@newtonschool.co
```

Start the server again (`npm run dev`) and reload. You should see an
**Admin** tab, and the board should show all seven rooms.

**Check:** click a green hour, book something, and confirm it turns red.

---

## Part 6 — Rename the batches

The seed creates `1st Year - A/B/C` and `2nd Year - A/B/C` as placeholders.

Go to **Admin → Batches** and rename them to whatever your college actually
calls them, and set each one's real strength. Strength is what drives the
"this batch will not fit in this room" warning.

Then hand the link to the other teachers. As each one signs in, they appear
in **Admin → People** as a student by default — switch them to **Faculty**
so they can book. Students need no action; they pick their batch themselves.

---

## Part 7 — Turn on real email

Until now `EMAIL_PROVIDER=console` means the app writes what it *would* have
sent to the terminal. Nothing breaks; nothing is delivered. Pick one of these
two to send for real.

### Option A — Gmail (recommended, ~500 recipients/day)

1. Go to **myaccount.google.com/security** and turn on **2-Step Verification**
   if it is not on. App Passwords do not exist without it.
2. Go to **myaccount.google.com/apppasswords**.
3. App name: `Room Board`. Create. Google shows a **16-character password**.
   Copy it — you cannot see it again.
4. In `.env.local`:

```
EMAIL_PROVIDER=gmail
EMAIL_FROM_NAME="NST Room Board"
EMAIL_FROM_ADDRESS=your.email@gmail.com
GMAIL_USER=your.email@gmail.com
GMAIL_APP_PASSWORD=abcdefghijklmnop
```

> Use the 16-character App Password, **not** your normal Google password.
> Remove the spaces Google shows between the groups of four.
>
> If your college Workspace account blocks App Passwords, use a personal
> Gmail here, or use Option B.

### Option B — Brevo (300 emails/day, no domain needed)

1. Sign up free at **brevo.com**. No card required.
2. **Senders & IP → Senders** → add your email → click the link they send you
   to verify it.
3. **SMTP & API → API Keys** → generate a key.
4. In `.env.local`:

```
EMAIL_PROVIDER=brevo
EMAIL_FROM_NAME="NST Room Board"
EMAIL_FROM_ADDRESS=the.verified@address.com
BREVO_API_KEY=xkeysib-...
```

### Test it

Restart `npm run dev`, book something with yourself signed in as a student in
another browser, then cancel it as the teacher with "Email the batches"
ticked. You should get the mail.

Everyone is **BCC'd**, so students never see each other's addresses.

---

## Part 8 — Put it online with Vercel

1. Push the project to GitHub (a **private** repo).
2. Go to **vercel.com**, sign in with GitHub, **Add New → Project**, and pick
   the repo. Vercel detects Next.js on its own — change no build settings.
3. Before deploying, expand **Environment Variables** and add **every line**
   from your `.env.local`. All of them, including the private key with its
   quotes and `\n`.
4. Deploy. You get a URL like `nst-room-board.vercel.app`.
5. **Important last step:** back in Firebase → **Authentication → Settings →
   Authorized domains → Add domain** → paste your Vercel domain.
   Without this, Google sign-in fails on the live site with
   `auth/unauthorized-domain`.

**Check:** open the Vercel URL on your phone, sign in, and book something.
It should appear on your laptop's board within a second.

Every push to GitHub redeploys automatically.

---

## Part 9 — Handing it to your teacher

She needs three things:

1. **The URL.**
2. **Admin access.** Ask her to sign in once, then run
   `npm run make-admin her.email@newtonschool.co`. Or, once you are an admin,
   just switch her role in **Admin → People** — no terminal needed.
3. **One sentence of instruction:** *"Green means free, click it to book.
   Red means taken. To move or cancel a session, click it."*

From then on she can run the whole thing — rooms, capacities, batches, who
counts as faculty — without you.

---

## When something goes wrong

| What you see | What it means |
|---|---|
| "Firebase is not connected yet" | `.env.local` is missing or the six `NEXT_PUBLIC_FIREBASE_*` values are blank. Restart the dev server after editing it — Next.js only reads env files at startup. |
| `auth/unauthorized-domain` | Part 8 step 5. Add your Vercel domain to Firebase → Authentication → Settings → Authorized domains. |
| "Use your college account (@…)" | The address you signed in with is not in `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS`. |
| "Missing or insufficient permissions" | The rules are not published (Part 4), or your domains in `firestore.rules` do not match your real email domain. |
| Board loads but has no rooms | `npm run seed` has not been run. |
| No **Admin** tab | `npm run make-admin` has not been run for your address. It only works after you have signed in once. |
| A teacher cannot book | They are still marked **student**. Fix it in Admin → People. |
| `error:1E08010C:DECODER routines` | The `FIREBASE_PRIVATE_KEY` lost its `\n` sequences or its quotes. Re-copy it from the JSON. |
| Email says "Nobody to email yet" | No student in those batches has signed in yet. Add addresses under Admin → Batches → Emails in the meantime. |
| `auth/operation-not-allowed` | That sign-in method is still off in Firebase → Authentication → Sign-in method. |

---

## What it costs

Firebase's free **Spark** plan gives you 50,000 document reads and 20,000
writes a day, and 1 GiB of storage. A campus board uses a tiny fraction of
that — a busy day might be a few thousand reads. Vercel's free Hobby plan
covers the hosting. Gmail and Brevo's free tiers cover the email.

Nothing here needs the paid Blaze plan, which is why there is no API route
using Cloud Functions.
