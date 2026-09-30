# Exam Scheduling System

A fully client-side exam scheduling and hall ticket system. It runs entirely
in the browser — no PHP, Java, MySQL, Firebase, or Node.js server required.
Data is stored locally in the browser using **IndexedDB**, and passwords are
hashed with the **Web Crypto API** (PBKDF2-SHA256, never stored in plain text).

## Project structure

```
exam-scheduling-system/
│
├── index.html               Landing page (applicants only — no admin link)
├── login.html                 Applicant login
├── register.html               Applicant registration (incl. security question)
├── admin-login.html              Admin sign-in + first-run admin setup
├── admin.html                      Admin dashboard ONLY — no login form, ever
├── applicant.html                    Applicant dashboard (bookings + account settings)
├── schedule.html                       Exam → Location → Date → Time booking workflow
├── hallticket.html                      Hall ticket view / print
├── reset-password.html                    "Forgot password" flow for both roles
│
├── css/
│   ├── style.css          Design tokens, nav, buttons, forms, tables
│   ├── login.css          Login/register/landing/reset page styles
│   ├── dashboard.css      Admin sidebar + applicant/scheduling styles
│   └── hallticket.css     Hall ticket (boarding-pass style) + print rules
│
└── js/
    ├── db.js              IndexedDB setup and generic data-access helpers
    ├── auth.js            Hashing, login security, sessions, password reset
    ├── admin-login.js       Admin sign-in + first-run admin account setup
    ├── admin.js              Admin dashboard: exams, slots, applicants, reports, security
    ├── applicant.js            Applicant dashboard: bookings + change password
    ├── schedule.js               Booking workflow + atomic seat-booking transaction
    └── hallticket.js               Hall ticket lookup, render, print
```

## 1. Setup instructions

No build step and no installation is required.

**Option A — just open it**
Double-click `index.html` to open it directly in your browser (Chrome, Edge,
or Firefox recommended). IndexedDB works from a `file://` URL in most
browsers.

**Option B — simple local server (recommended)**
Some browsers restrict certain APIs on `file://` URLs, so a tiny static
server is the safer option:

```bash
# From inside the exam-scheduling-system folder
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

or, with Node installed:

```bash
npx serve .
```

> **Internet connection note:** the app itself needs no internet connection
> to run. Two things are loaded from a CDN and need connectivity the first
> time they're used: the Google Fonts used throughout the design, and the
> SheetJS library (`admin.html` only) that builds the downloadable `.xlsx`
> file in the Security tab. Everything else — IndexedDB, hashing, sessions,
> booking logic — works fully offline.

### Creating the administrator account (first run)

**There is no default admin username or password shipped with this app.**
The very first time anyone opens `admin-login.html`, it detects that no
administrator account exists yet and shows a one-time setup form instead of
a login form: choose a username, a password, and a security question. Once
that account is created, `admin-login.html` always shows the normal sign-in
form from then on — the setup form can't be reached again (both the page
and `Auth.createFirstAdmin` re-check that no admin already exists before
allowing account creation).

Admin passwords are held to a stricter policy than applicant passwords,
since the account carries far more privilege: **at least 10 characters,
with upper case, lower case, a number, and a symbol.**

### Resetting all data

All data lives in one IndexedDB database named `ExamSchedulingSystemDB`. To
wipe everything and start fresh (including the administrator account, so
you'll see the first-run setup form again), open DevTools → Application →
IndexedDB → delete that database, or run
`indexedDB.deleteDatabase('ExamSchedulingSystemDB')` in the console, then
reload.

## 2. How admin access is isolated from the applicant site

- **Separate entry points.** Applicants use `login.html` / `register.html`.
  Administrators use `admin-login.html`. The public landing page
  (`index.html`) has no admin link at all — an administrator is expected to
  know the URL, not discover it from the applicant-facing site.
- **The dashboard URL is not the protection — the session is.** `admin.html`
  contains no login form. If you type it in directly without a valid admin
  session, `admin.js` detects that immediately (before fetching or
  rendering any dashboard data) and redirects to `admin-login.html`. The
  page briefly shows a plain "Checking your session…" placeholder with no
  sensitive markup while that check runs.
- **Every admin action re-checks the session, not just the page load.**
  Creating/editing/deactivating exams, creating/editing slots, viewing
  applicants, viewing or exporting reports, unlocking accounts, viewing
  login activity, and exporting the Excel workbook all call the same
  session guard immediately before doing anything. A session that expires
  mid-visit (30-minute inactivity timeout) can't be used to keep editing
  data — the very next action bounces you back to `admin-login.html`. A
  60-second background check does the same even if you just leave the tab
  open and idle.
- **Roles can't be reused across each other.** Applicant pages require a
  session with `role: 'applicant'`; the admin dashboard requires
  `role: 'admin'`. An admin session opened in the same tab will not pass
  the applicant pages' checks, and vice versa.
- **The back button can't reopen a signed-out view.** `admin.html`,
  `admin-login.html`, `applicant.html`, `schedule.html`, and
  `hallticket.html` all send `Cache-Control: no-store` (a best-effort
  browser hint — a real deployment should also send the equivalent HTTP
  header from the server) and listen for the browser's back/forward-cache
  restore event to re-verify the session from scratch rather than trusting
  a cached render.
- **Logout is a full, clean break.** It clears `sessionStorage`, drops all
  in-memory dashboard data the page was holding, and navigates fully (not
  an in-page view swap) to `admin-login.html`.

## 3. Secure login

Both applicant and admin sign-in include:

- **Account lockout** — after 5 failed sign-in (or password-reset answer)
  attempts for the same account within 15 minutes, further attempts are
  blocked with a "try again in N minutes" message. An administrator can
  clear this early from **Admin → Security → Unlock an account**.
- **Stronger requirements for admin accounts** — see the password policy
  above, plus a mandatory security question set at account creation.
- **Full audit trail** — every sign-in attempt (success, failure, lockout)
  and every password-reset attempt is written to a `loginLogs` store and
  shown in **Admin → Security → Login activity**.
- Passwords remain PBKDF2-SHA256 hashed with a random per-account salt,
  sessions remain `sessionStorage`-based with a 30-minute inactivity
  timeout and a fresh session token on every login (see the security notes
  at the bottom for what this can and can't guarantee without a backend).

## 4. Password reset

Both applicant and admin accounts set a **security question** at account
creation, and can reset a forgotten password from `reset-password.html`:

1. Choose the account type (applicant or admin) and enter the email /
   username.
2. Answer the security question on file for that account.
3. Choose and confirm a new password (the form enforces the stricter admin
   policy automatically when "administrator account" is selected).

Signed-in users can also change their password (and update their security
question) any time without going through this flow:

- **Applicants:** on `applicant.html`, under "Change my password" / "My
  security question".
- **Admins:** on `admin.html`, in the **Security** tab.

## 5. Login data in Excel format

The **Admin → Security** tab includes a **"Download Excel (.xlsx)"** button.
It builds a real Excel workbook (via SheetJS, loaded from a CDN) with three
sheets, so an administrator can save or archive it locally:

- **Login Activity** — every sign-in and password-reset attempt: date/time,
  account type, email/username, name, status, and detail.
- **Applicant Accounts** — name, email, mobile, registration date, whether a
  security question is set, and total bookings.
- **Admin Accounts** — username, creation date, and whether a security
  question is set.

Password hashes, salts, and security answers are never included in the
export. The file downloads directly to the browser's usual downloads
location as `login-security-data-<timestamp>.xlsx`.

(The existing **Reports** tab still has its own **Export CSV** button for
booking/hall-ticket data — that's unrelated to the login data above and is
left as CSV since it's meant for quick spreadsheet import, not archiving.)

## 6. Testing instructions

A suggested walkthrough that exercises every feature:

1. **Create the administrator account** — open `admin-login.html`. Since no
   admin exists yet, you should see the one-time setup form. Create an
   account; you'll land directly in the dashboard.
2. **Confirm isolation** — open `index.html` and confirm there's no admin
   link. Try opening `admin.html` directly in a fresh private/incognito
   window (no session) and confirm it bounces straight to
   `admin-login.html` without ever showing dashboard content.
3. **Register an applicant** — open `register.html`, create an account,
   choosing a security question and answer. Try a weak password or
   mismatched confirmation first to see validation.
4. **Create an exam** — Exams tab → "New Exam". Example:
   - Exam Name: `Aviation Entrance Examination`
   - Exam Code: `AVI`
   - Status: `Active`
5. **Create a slot** — Slots tab → "New Slot". Example:
   - Exam: Aviation Entrance Examination
   - Location: `Vijayawada`, Location Code: `VJA`
   - Date: `2026-08-20`, Start: `10:00`, End: `12:00`
   - Capacity: `2` (use a small number so you can test the "FULL" state quickly)
6. **Sign in as the applicant** you registered in step 3, then click
   **Schedule New Exam**. Walk through Exam → Location → Date → Time,
   select the slot, and confirm the booking.
7. **Check the hall ticket** — you should land on `hallticket.html` with an
   auto-generated hall ticket number in the form `AVI-2026-VJA-0001`, and a
   serial number of `1`. Click "Print Hall Ticket" to see the A4 print
   layout.
8. **Test the seat limit** — register a second applicant account and book
   the same slot until it reaches capacity, then try a third booking: the
   slot should show **FULL** and be unselectable, and the same exam cannot
   be booked twice by the same applicant.
9. **Test account lockout** — on `login.html`, enter a registered email
   with the wrong password 5 times in a row. The 6th attempt should show a
   lockout message. Then go to `admin.html` → Security → "Unlock an
   account" and clear it.
10. **Test password reset** — from `login.html`, click "Forgot your
    password?", answer the applicant's security question, and set a new
    password. Repeat for the admin account via `admin-login.html`'s
    "Forgot your password?" link.
11. **Test session expiry / back button** — sign in as admin, then in
    DevTools console run `sessionStorage.clear()` to simulate an expired
    session, and click any dashboard action — it should bounce you to
    `admin-login.html`. Separately, sign out and press the browser's back
    button — it should not show a cached dashboard.
12. **Back in the admin dashboard** — check the Dashboard tab's counters,
    the Slots tab (Booked/Available should reflect your test bookings), the
    Applicants tab (search by name/email), and the Reports tab: filter by
    exam/location/date, then try **Export CSV** and **Print**.
13. **Check the Security tab** — confirm your test sign-ins, failures, and
    the password reset all appear in Login activity, filter by account
    type/status, then click **Download Excel (.xlsx)** and open the file to
    confirm all three sheets are populated.

## Notes on the security model

This is a static, serverless app, so "security" here means *good hygiene
within that constraint*, not server-grade authentication:

- Passwords are never stored in plain text — only a PBKDF2-SHA256 hash and
  a random per-user salt. The same applies to security-question answers.
- There is no seeded, known admin username/password anywhere in the code —
  the account only exists once an administrator creates it themselves.
- Sessions live in `sessionStorage` (cleared when the tab closes) with a
  30-minute inactivity timeout and a fresh random session token generated
  on every login.
- Account lockout is tracked from the login-activity log (rolling 15-minute
  window), not a separate "banned" flag, so it clears itself automatically
  as failures age out, or immediately if an admin clears it.
- Every protected page re-checks the session's role before rendering
  anything sensitive, and admin actions re-check it again before executing.
- **This is still not server-grade security, and it can't be.** Anyone with
  DevTools access to the browser can inspect the IndexedDB contents,
  extract password hashes (though not the passwords themselves), or step
  through and modify the JavaScript to skip a check — there's no way around
  that without a real backend, because the "server" and the "client" are
  the same machine here. If this system will ever store real applicant
  PII, official exam data, or hall tickets with real stakes, the
  recommended path is to move authentication, session issuance, and all
  data storage to a real backend (a server-held session or JWT, a proper
  database, HTTPS, and server-side authorization checks on every request)
  and treat this client-side version as a prototype or offline demo, not a
  production system. A future backend version would also be where
  something like optional two-factor authentication for admin accounts
  becomes practical — it isn't meaningful to implement 2FA against a
  secret that ultimately lives in the same browser storage it's meant to
  protect.
