# Creator Reply Studio

A private workspace for drafting and reviewing non-explicit replies to adult clients and managing conversations through WhatsApp.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/creator-reply run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `DATABASE_URL` is provided by the project's PostgreSQL database.
- Replit Secrets: `SESSION_SECRET` (at least 32 characters) and `WHATSAPP_ACCESS_CODE` (exactly four digits) are required for sign-in.
- `GEMINI_API_KEY` is required for standalone AI drafts and on-demand WhatsApp reply suggestions; the app can still open without it.

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

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

The app supports standalone AI reply drafting and a WhatsApp inbox that groups incoming direct messages by number. Every WhatsApp reply is sent manually. Four Gemini suggestions can be generated on demand after a one-time 18+ confirmation for that message; no approved-contact list is stored and nothing is sent automatically.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- WhatsApp captures new incoming direct text messages after pairing; it does not import earlier chat history.
- Replies are manual. The API rejects requests to enable automatic sending.
- WhatsApp suggestion generation is on demand; the selected message and display name are sent to Gemini, and the adult confirmation is not persisted.
- If a WhatsApp send result is uncertain, the inbox item must be checked manually; do not retry the reply automatically.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
