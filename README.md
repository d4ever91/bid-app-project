# Ordinal · Admin Console (Svelte + TypeScript)

Svelte 4 + Vite + TypeScript port of the admin console design. Strict mode, typed props,
typed component events.

## Run

    npm install
    npm run dev                 # API on :4000 + app on :5173, together

`npm run dev` starts both the API (`server/`) and the Vite app, and installs the API's
dependencies the first time. Ctrl+C stops both. To run them separately: `npm run api` and
`npm run dev:web`. If the app shows "The API server isn't running", the API on port 4000
isn't up — start it with one of those commands.

Open http://localhost:5173 and sign in as `a.mercer@ordinal.io` / `ordinal-dev-password`,
or create a new workspace from "Create a workspace".

    npm run check               # svelte-check type pass
    npm run api:test            # API end-to-end tests
    npm run api:seed            # reset the API's demo data (restart the API afterwards)

## API server (`server/`)

Express 5 API that implements every call in `src/api.ts`. Data lives in a JSON file
(`server/data/db.json`, git-ignored) so there's no database to install. The first start seeds
the demo workspaces, users and bids. The route code only touches the `db.*` collections in
`server/src/db.js`, so moving to Postgres or Mongo later is contained to that layer.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/signup` · `/auth/login` · `/auth/refresh` · `/auth/logout` · `/auth/accept-invite` · `/auth/reset-password` · `GET /auth/me` |
| Users | `GET /users` (q, role, team, status, mfa, archived, sort, page, limit) · `/users/facets` · `/users/:id` · `POST /users` · `PATCH /users/:id` · `/:id/role` · `/:id/status` · `POST /users/:id/reset-password` · `/:id/restore` · `/users/bulk` · `DELETE /users/:id` · `/:id/purge` |
| Invites | `GET /invites` · `POST /invites` · `POST /invites/:id/resend` · `DELETE /invites/:id` |
| Bids | `GET /bids` (q, stage, owner, sector, due, archived, sort, page, limit) · `/bids/summary` · `/bids/:id` · `POST /bids` · `PATCH /bids/:id` · `/:id/stage` · `/:id/tasks` · `POST /bids/:id/notes` · `/:id/restore` · `DELETE /bids/:id` |
| Subscription | `GET /subscription/plans` (public) · `GET /subscription` · `POST /subscription` · `/checkout-session` · `/portal-session` · `GET /subscription/invoices` |
| Assistant | `GET /assistant/suggestions` · `POST /assistant/chat` |

- **Sessions:** 15-minute JWT access token in the response body; 30-day refresh token in an
  httpOnly cookie (`path=/api/auth`) that rotates on every refresh. Only token hashes are stored.
- **Workspaces are isolated:** every query is scoped to the signed-in user's workspace.
- **Roles:** Owner and Admin manage users and invites; only an Owner can grant or remove Owner
  or change billing; Read-only can't change bids; nobody can demote, suspend or archive
  themselves or the last active Owner.
- **Signup** validates the "About your company" answers (`company.role`, `company.country`,
  `company.sectors`, `company.bidVolume`) and stores them on the workspace.
- **Email:** no mail provider is wired up — invite and password-reset links are printed to the
  API console (`[mail] …`). In development, `POST /users` and `POST /invites` also return the
  `inviteToken`.
- **Payments:** no Stripe integration yet. Checkout and portal endpoints return `url: null`
  with a message, and a "Pay now" signup starts on the 14-day trial instead.
- **Assistant:** answers from live workspace data out of the box; set `ANTHROPIC_API_KEY` in
  `server/.env` to route chat to Claude instead.
- **CORS:** `http://localhost:5173` is allowed (with credentials) for clients that call the API
  directly; in development the Vite proxy makes requests same-origin anyway. Add production
  origins to `CORS_ORIGINS`.

Config lives in `server/.env` — copy `server/.env.example`. In production set `NODE_ENV=production`
and `JWT_SECRET`, or the API refuses to start.

## Structure

    src/
      App.svelte                 screen state, user state, toasts
      types.ts                   User, Role, Status, Screen, Density, ChatMessage…
      data.ts                    mock roster, roles, chart/audit data, helpers
      ui.ts                      shared inline-style strings + row density map
      assistant.ts               chat transport + offline heuristic answers
      app.css                    CSS variables, resets, hover/focus states
      vite-env.d.ts              Vite + VITE_ASSISTANT_URL env typing
      lib/
        Sidebar.svelte           dark left nav (Overview / Users / Invite / AI assistant)
        TopBar.svelte            breadcrumb + invite action
        Toast.svelte             transient confirmation
        EditProfileModal.svelte  edit name / email / team
        Login.svelte             SSO sign-in + platform status
        Overview.svelte          KPI tiles, sign-in chart, role mix, audit feed
        Users.svelte             searchable + role-filtered user table
        UserDetail.svelte        profile, role change, security, activity
        InviteUser.svelte        invite form with role picker
        Assistant.svelte         AI chat screen
        Signup.svelte            three-step signup: account → company questions → plan
        NewUser.svelte           create/invite a user (shared form, two modes)
        NewBid.svelte            log a new bid opportunity
      icons.ts                   inline SVG bodies for the sidebar
        Profile.svelte           your account: details, notifications, sessions, security
        Billing.svelte           plan tiers, usage, invoices, payment method
      subscription.ts            plans, seats, usage, invoices, sessions, money helpers
        Bids.svelte              bid pipeline: KPIs, stage mix, filterable list
        BidDetail.svelte         one bid: checklist, log, readiness, facts
      bids.ts                    bid roster, stage colours, money/due formatters

## Types

\`types.ts\` is the single source of truth. \`Role\` and \`Status\` are string unions, so a
typo in a role name fails the build; \`ROLE_INFO\` is a \`Record<Role, RoleInfo>\`, so adding
a role forces you to describe its scopes. Every child component declares its props with
types and its events through \`createEventDispatcher<{ … }>\`, so \`App.svelte\` gets
checked event payloads (\`e.detail\` is \`Role\`, \`Screen\`, \`ProfileDraft\`, …).

## Bid management

\`Bid management\` in the sidebar shows the live pipeline — unweighted and probability-weighted
value, win rate over decided bids, and anything due inside 7 days — then a stage-filtered list.
Opening a bid gives its submission checklist, bid log, readiness bars, and key facts;
**Advance stage** walks it along \`BID_STAGES\` and toasts the change.

\`App.svelte\` owns the \`bids\` array, so stage changes flow back into the list and KPIs.
\`bids.ts\` holds the mock roster and the formatters (\`money\`, \`dueLabel\`, \`dueColor\`).

## Signup & shell

\`Login\` links to a three-step **Signup**:

1. **Your account** — workspace name, domain, name, work email, password (validated — required
   fields, email shape, 12-character password).
2. **Your company** — six short questions: your role, country, company type,
   employees, sectors you bid into (multi-select) and bids per year. Options live in
   \`src/types.ts\` (\`SIGNUP_ROLES\`, \`BID_SECTORS\`, …).
3. **Choose a plan** — plan, seats, trial vs paid, terms acceptance.

The answers are sent to \`POST /auth/signup\` as a \`company\` object (\`CompanyProfile\`), alongside
the existing top-level \`size\` and \`companyType\` for backward compatibility. If the server
rejects a field (\`role\` or \`company.role\`, etc.) the user is sent back to the step that holds it.
Completing signup seeds the plan and the signed-in name, then drops into Overview.

The sidebar carries inline SVG icons and collapses to a 56px icon rail via the « / » toggle;
\`App.svelte\` owns \`collapsed\` and swaps the shell's grid column.

## Create forms

**New user** and **Invite user** (Users toolbar) open the same \`NewUser\` form in different
modes — it validates name, email and duplicate addresses, picks role and team, and appends an
Invited account. **New bid** (Bids toolbar) captures the opportunity, commercials and ownership,
rejects duplicate reference numbers, and creates the bid with a starter checklist before opening
its detail page. The top-bar action follows the section you're in.

## Subscription (SaaS)

An **Account** group in the sidebar (and the clickable identity block at its foot) opens two
screens:

- **Your profile** — editable personal details with a dirty-state marker, notification toggles,
  active sessions with sign-out-others, security summary, personal API token, and an ownership
  transfer guard in the danger zone.
- **Subscription** — three plan tiers (Team / Business / Enterprise) priced per seat with a
  monthly ⇄ annual switch, contract-value and seat-utilisation KPIs, a pending-change banner
  when the selection differs from the live plan, usage meters against plan limits, the invoice
  archive, payment method, billing details, and a cancellation path.

\`subscription.ts\` holds the plan catalogue and account state; \`money\`, \`seatPrice\` and
\`contractTotal\` are the pricing helpers. Plan changes are staged locally and announced by
toast rather than applied instantly — wire them to your billing provider (Stripe subscription
items keyed by \`PlanId\` + \`BillingCycle\`) when you have one.

## Bids: server paging and filtering

With a session, the bids table is fully server-driven: 25 rows a page, and every filter —
search, stage chips, owner, sector, deadline bucket, sort — is sent up as query parameters
rather than applied to the loaded page. Results therefore reflect the whole workspace, not
whatever happened to be fetched.

- Any filter change resets to page 1 — staying on page 4 of a different result set is never
  what the user meant.
- Owner and sector dropdowns are populated from the unpaged set once, since a single page
  can't tell you which owners exist.
- The footer shows the real range (`26–50 of 214`) and disables prev/next at the ends.
- Without a session the fixture list filters and sorts locally, exactly as before.

## Every endpoint, wired

`src/api.ts` now covers the whole API surface; `src/adapters.ts` translates between the
server's records and the shapes the components already render.

| Group | Client functions |
| --- | --- |
| Auth | `login`, `signup`, `refresh`, `logout`, `me`, `restoreSession` |
| Users | `fetchUsers`, `fetchUserFacets`, `fetchUser`, `createUser`, `updateUser`, `changeUserRole`, `changeUserStatus`, `resetUserPassword`, `archiveUser`, `restoreUser`, `purgeUser`, `bulkUsers` |
| Invites | `fetchInvites`, `createInvite`, `resendInvite`, `revokeInvite` |
| Bids | `fetchBids`, `fetchBidSummary`, `fetchBid`, `createBid`, `updateBid`, `changeBidStage`, `toggleBidTask`, `addBidNote`, `archiveBid`, `restoreBid` |
| Billing | `fetchPlans`, `fetchSubscription`, `changePlan`, `startCheckout`, `openBillingPortal`, `fetchInvoices` |
| Assistant | `assistantChat`, `assistantSuggestions` |

### Two decisions worth knowing

**Fixtures remain a real fallback.** Every screen checks `getAccessToken()`: with a session
it reads and writes through the API, without one it runs on `src/data.ts`. That is what
keeps the design-review flow and the "Continue with demo data" path working, and it is the
only reason the fixture modules are still imported.

**Adapters instead of a rewrite.** The components were built against fixture shapes
(`id`, `ref`, "2 days ago"). Rather than change every component to speak the server's
schema, `toUser` / `toBid` convert at the boundary and `userQueryFrom` / `bidQueryFrom`
map filter state onto query parameters.

### Behaviour

- **Filtering is server-side when live** — query and role changes refetch rather than
  filtering the loaded page, so results reflect the whole workspace.
- **Filter dropdowns come from `/users/facets`** with counts, since a page of rows can't
  tell you which teams exist.
- **Bulk actions** — select rows for a toolbar offering role, status, reset-password and
  archive. Partial success is surfaced: if the server declines a row (your own account, the
  last Owner) the toast carries the reason.
- **Mutations are optimistic** — the row updates immediately and reverts on failure.
- **The assistant** prefers the server proxy (which holds the provider key), falling back to
  in-browser and then to the local answerer.

## Plans and payment

The signup plan step reads its catalogue from `GET /subscription/plans` (the server prices
the Stripe line items, so it is the authority) and falls back to `src/subscription.ts` when
the API is unreachable. The step collects three things beyond the plan: billing cycle, seat
count — clamped to the plan's cap — and whether to start a trial or pay now.

- **14-day free trial** — no card; the workspace is created `trialing`.
- **Pay now** — designed to return a Stripe Checkout URL that the browser redirects to
  (Stripe returns to `?checkout=success|cancelled`, shown as a toast). The bundled API has no
  Stripe integration yet, so it returns no URL and starts the workspace on the trial.

An order summary shows unit price × seats and what's due today, so nothing about the charge
is a surprise at the Stripe screen.

On the Subscription screen, plan changes call `POST /subscription` when a session is live
(and fall back to the fixture behaviour in demo mode), "Pay now" opens Checkout, and
"Update card" opens the Stripe billing portal.

## Talking to the API

`src/api.ts` is the only place that knows the server's response envelope. It holds the
access token **in memory** (never localStorage) and relies on the httpOnly refresh cookie
for persistence — every request sends `credentials: 'include'`. A 401 triggers one silent
refresh-and-replay before the call is allowed to fail, and `restoreSession()` runs on mount
so a page reload doesn't sign you out.

```
npm run dev     # API on http://localhost:4000/api + app on http://localhost:5173
```

Seeded accounts (password `ordinal-dev-password` for all of them):

| Email | Role | Workspace |
| --- | --- | --- |
| `a.mercer@ordinal.io` | Owner | Ordinal |
| `n.beshara@ordinal.io` | Admin | Ordinal |
| `m.quintero@ordinal.io` | Engineer | Ordinal |
| `b.vance@ordinal.io` | Read-only | Ordinal |
| `rosa@acme-survey.com` | Owner | Acme Survey Co |

In development the app calls the same-origin path `/api`, and the Vite dev server
(`vite.config.ts`) proxies it to `http://localhost:4000`. The browser only ever talks to
`http://localhost:5173`, so the API needs no CORS setup for local work. Change the proxy
target with `API_PROXY_TARGET` in `.env`.

For a deployed build served from a different domain than the API, set `VITE_API_URL` to the
API's full URL and add the frontend's origin to the API's CORS allow-list (with credentials,
since the refresh token is a cookie).

**Without the API running**, login reports that it can't reach the server and offers
"Continue with demo data instead" — the screens still work against the local fixtures in
`src/data.ts`, which is what the design review flow uses. Signup does the same.

Server-side validation errors are merged into the same field-error display as the client
rules, so a rejected email shows under the email input rather than in a toast.

## Form validation

`src/validation.ts` is a small rule-based validator — no dependency. A rule takes the
field value plus the whole draft and returns a message or `null`; the first failure per
field wins, so messages stay specific.

```ts
const schema: Schema<NewUserDraft> = {
  name: [required('Enter the person’s full name'), minLen(2), maxLen(80)],
  email: [required('A work email is required'), email(), unique(() => users.map(u => u.email))]
};

$: errors = runSchema(draft, schema);
$: shown = visible(errors, touched, submitted);
```

Rules available: `required`, `email`, `domain`, `minLen`, `maxLen`, `pattern`,
`integer`, `range`, `unique`, `dateish`, `accepted`.

`visible()` is what keeps the forms calm: an error is only painted once its field has
been **blurred**, or once the user has attempted to submit — a pristine form is never a
wall of red. `src/lib/Field.svelte` renders label, input, red border and message together
so every form errs identically.

Wired into: Login, Signup (steps 1 and 2), New user, New bid, Edit profile. Submit buttons are no
longer disabled — clicking reveals what's wrong rather than leaving the user guessing why
the button is dead.

## Advanced filters

Both tables carry an **Advanced filters** toggle above the table on the right, with a live
count of what's applied. Users filters on team, status and MFA state and sorts by name, role,
team or password age; Bids filters on owner, sector and deadline bucket and sorts by due date,
value, win probability or client. The funnel-with-x icon button (next to the toggle and inside
the panel) removes every filter at once, including the search box and the role/stage selection
owned by \`App.svelte\`.

## AI assistant

The sidebar's **AI assistant** screen posts to your own backend:

    POST  VITE_ASSISTANT_URL (default /api/assistant)
    body  { system, messages: [{ role, content }], roster }
    200   { text: "..." }

Proxy that route to Anthropic's Messages API server-side — never ship an API key to the
browser. \`SYSTEM_PROMPT\` and the roster serializer live in \`src/assistant.ts\`.

Until the route exists the chat falls back to \`answerLocally()\`, which answers the common
audit questions (MFA gaps, stale passwords, suspended accounts, pending invites, elevated
roles, single-user lookups) straight from local data and labels the reply as computed
locally. The status pill in the header shows which mode is live.

## Notes

- Styling is inline style strings from \`ui.ts\` plus CSS variables in \`app.css\`; only
  hover/focus needs real CSS.
- \`App\` props: \`startScreen\`, \`density\` ('Dense' | 'Balanced' | 'Roomy'), \`maskEmails\`
  — set them in \`main.ts\`.
- All data is local mock state. Swap \`data.ts\` for API calls; \`patchSelected\` in
  \`App.svelte\` is the single write path.
- No router by design. Add SvelteKit routes or svelte-spa-router by mapping each \`Screen\`
  value to a route.
