# Backend — WODGoat API
Shared rules: `../CLAUDE.md`. API contract: `API_ENDPOINTS_SPEC.md` (keep in sync with routes).

## Stack
Express + TypeScript (strict), Firebase Admin / Firestore, JWT auth, multer, Gemini (voice workout), expo-server-sdk (push). Deployed on Vercel (`app.ts` is the single function). `functions/` holds Firebase Cloud Functions (separate package).

## Commands
- `yarn dev` / `yarn dev:watch` — run locally (ts-node)
- `yarn build` — `tsc` to `dist/`
- `yarn seed:exercises` — seed exercise library (first time only)
- `yarn test` — run Vitest once; `yarn test:watch` — watch mode. Tests live next to the code as `*.test.ts` (excluded from the `tsc` build). Unit tests of pure functions need no emulator; emulator-based tests will come later. Never run tests or seeds against production (see `../CLAUDE.md` Testing).

## Structure
- `app.ts` mounts routers under `/api/<module>`.
- `modules/<name>/{routes,controller,model,middleware,utils}.ts` — one folder per feature (user, workout, personal-record, group, group-workout, program, join, exercise, voice-workout, notification, subscription, admin, coach, event, streak).
- `middleware/auth.ts`, `middleware/adminAuth.ts`; `types/*.types.ts` shared types; `config/firebase.ts`.

## Env
See `.env.example`. Gemini runs through Vertex AI (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`).

## Rules
- New endpoint: add to spec, then routes -> controller -> model; validate input; use auth middleware; return `{ success, ... }` shape like existing endpoints.
- Routes stay thin; logic in controller/model/utils.
- Never log tokens, passwords or Firebase keys. `.env` is secret.
- Package manager is Yarn only.
- Gemini: use `@google/genai` only.
- Firebase connection is created only in `config/firebase.ts`.
