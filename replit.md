# Telegram Earning Bot

একটি Telegram bot যেখানে users balance দেখতে, file submit করতে এবং withdrawal request করতে পারে; admin group থেকে approve/reject করা যায়।

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- **grammy** used for Telegram bot (externalized from esbuild bundle — added to `external` in `build.mjs`)
- **better-sqlite3** for local DB (approved in `pnpm-workspace.yaml` `onlyBuiltDependencies`; DB stored at `artifacts/api-server/bot-data.db`)
- Bot runs alongside the Express server in the same process (non-blocking via `void bot.start()`)
- All bot handlers registered inside `registerHandlers()` — bot instance created inside `startBot()` so server starts even without `BOT_TOKEN`
- Admin approve/reject authz: checks `ctx.chat.id === ADMIN_GROUP_ID` before processing

## Product

**User features:**
- `/start` — main menu with 3 buttons: Balance, Submit File, Withdrawal
- Balance — shows current balance from DB
- Submit File — user sends any file (doc/photo/video/audio); forwarded to admin group
- Withdrawal — multi-step: choose bKash/Nagad/Binance UID → account number → amount (min 20) → confirm → admin group notified

**Admin features (in private group):**
- Receives withdrawal requests with ✅ Approve / ❌ Reject buttons
- Approve/reject updates DB and notifies the user via bot
- Receives submitted files with metadata

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
