# Wakajaye

A local tenant portal modeled on [Kivo](https://github.com/yemiSage/kivo). The reference backdrop is retained with the accompanying Kivo license. Wakajaye has its own handwritten SVG wordmark.

## Run locally

Use Node.js 20.9 or later and install dependencies with `npm ci`. Run [supabase.sql](supabase.sql) once in the SQL editor of your Wakajaye Supabase project.

Set these variables in `.env.local`:

- `SUPABASE_DB_URL` is the PostgreSQL connection string from the Supabase Connect dialog. Use the session pooler if your network lacks IPv6. Production uses the restricted `wakajaye_app` role with access to the private Wakajaye tables only.
- `BREVO_API_KEY` is the Brevo transactional API key.
- `BREVO_FROM_EMAIL` is a verified sender email in Brevo.
- `AUTH_SECRET` is an optional dedicated server authentication secret (at least 32 random bytes). Existing deployments use a domain-separated HMAC with `BREVO_API_KEY` when it is absent. Rotating the effective secret invalidates pending OTPs and admin sessions.

The only administrator is `adegboyeopeyemi065@gmail.com`, pinned server-side. Admin sign-in is at `/admin/me` and requires a separate email OTP even if that email is already signed in to the tenant portal. Admin sessions expire after one hour; tenant sessions expire after seven days. The previous `WAKAJAYE_ADMIN_EMAIL` setting no longer changes access.

Then run `npm run dev` and open http://127.0.0.1:3000. Verification codes and approved receipts are sent through Brevo. Tenant records, sessions, and uploaded receipts are stored in the private Wakajaye schema in Supabase.

Trap by Aayush Mayank is bundled locally. Source: https://befonts.com/trap-sans-serif-font-family.html

## Vercel

Import this repository on Vercel with the Next.js framework preset and the repository root as the root directory. Set the three required server variables above (`SUPABASE_DB_URL`, `BREVO_API_KEY`, `BREVO_FROM_EMAIL`) and deploy. Apply the Supabase schema before signing in. Proof uploads are limited to 3 MB. Authentication attempt counters use reserved rows in the private codes table; no additional schema migration is required.

The browser UI source is in `src/portal.js`. `npm run build:client` bundles only the Iconsax icons used by the app into `public/portal.js`. The normal dev and production build scripts run this step automatically. The agreement PDF and on-screen text share the template in `content/residential-tenancy-agreement.txt`.

Run `npm test` for authentication, authorization, onboarding, payment validation and frontend regression checks. See `docs/security-review.md` for the security review and its limits.
