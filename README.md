# Family Safety Hub

A parental-controls web app built around **transparency and consent**. Parents set daily screen-time
limits, bedtimes and blocked websites; kids can see exactly what their parent sees, ask for extra
time, and send check-ins.

## Principles

- **Nothing is hidden from the child.** A paired device reports nothing until the child has read and
  acknowledged a notice that lists what is shared and what is never collected. The device's home
  screen always shows the same data the parent sees.
- **Summaries, not surveillance.** The app stores minutes per app or website per day. It does not
  collect message content, keystrokes, screenshots or location.
- **Minimal secrets.** Passwords are hashed with scrypt. Session and device tokens are random, and
  only their SHA-256 hashes are stored. Removing a device revokes its token and deletes what it
  reported.

## Features

| Parent dashboard (`/`)                       | Child's device (`/device`)                   |
| -------------------------------------------- | -------------------------------------------- |
| Child profiles with daily limit and bedtime  | Pair with a one-time, 15-minute code         |
| Today's usage by app or site, 7-day chart    | Monitoring notice that must be acknowledged  |
| Approve or deny requests for more time       | Remaining time and today's usage             |
| Blocked websites                             | Ask for more time, send a check-in           |
| Pair or remove devices, see last-seen time   | "What your parent can see", always visible   |

A real device agent (browser extension or mobile app) would post usage to `/api/device/usage`.
Until one exists, the device page has an **Add activity** form so the app can be tried end to end.

## Stack

- Node.js 22.13+ with the built-in `node:sqlite` (no native modules), Express 5 and Zod
- React 19 + Vite for the front end
- Vitest + Supertest for API tests

## Getting started

```bash
npm install
npm run dev        # API on http://localhost:3000, UI on http://localhost:5173
```

Open http://localhost:5173 to create a parent account, add a child and pair a device. Open
http://localhost:5173/device in another browser (or a private window) to act as the child's device.

```bash
npm run check      # typecheck + tests + production build
npm run build && npm start   # serves the built UI and API on http://localhost:3000
```

## Configuration

All variables are optional. See `.env.example`.

| Variable        | Default                       | Purpose                                                |
| --------------- | ----------------------------- | ------------------------------------------------------ |
| `PORT`          | `3000`                        | HTTP port                                              |
| `DATABASE_PATH` | `data/family-safety-hub.db`   | SQLite file (`:memory:` for a throwaway database)      |
| `NODE_ENV`      | `development`                 | `production` adds the `Secure` flag to session cookies |
| `WEB_DIR`       | `dist/web`                    | Built front end to serve                               |

## API overview

Parent endpoints use an HttpOnly session cookie. Device endpoints use `Authorization: Bearer <token>`.

| Method & path                              | Who    | Purpose                                          |
| ------------------------------------------ | ------ | ------------------------------------------------ |
| `POST /api/auth/register`, `/login`, `/logout`, `GET /api/auth/me` | parent | Account and session |
| `GET/POST /api/children`, `PATCH/DELETE /api/children/:id` | parent | Child profiles and rules           |
| `GET /api/children/:id/summary?day=`       | parent | Usage, week, devices, requests, check-ins        |
| `POST /api/children/:id/devices`           | parent | Create a device and get a pairing code           |
| `DELETE /api/devices/:id`                  | parent | Unpair a device and delete its data              |
| `POST /api/children/:id/blocked-sites`, `DELETE /api/blocked-sites/:id` | parent | Blocked websites      |
| `POST /api/time-requests/:id/decision`     | parent | Approve or deny extra time                       |
| `POST /api/device/pair`                    | device | Exchange a pairing code for a token              |
| `POST /api/device/acknowledge`             | device | Record that the child read the notice            |
| `GET /api/device/policy?day=`, `GET /api/device/me?day=` | device | Limits, remaining time, own data   |
| `POST /api/device/usage`, `/time-requests`, `/check-ins` | device | Report usage, ask for time, check in |
