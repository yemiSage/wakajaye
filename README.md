# Wakajaye

A local tenant portal modeled on [Kivo](https://github.com/yemiSage/kivo). The reference backdrop is retained with the accompanying Kivo license. Wakajaye has its own handwritten SVG wordmark.

## Run locally

Use Node.js 20.9 or later and install dependencies with `npm ci`. Run [supabase.sql](supabase.sql) once in the SQL editor of your Wakajaye Supabase project.

Set these variables in `.env.local`:

- `SUPABASE_DB_URL` is the PostgreSQL connection string from the Supabase Connect dialog. Use the session pooler if your network lacks IPv6. Use the database role that owns the Wakajaye schema.
- `BREVO_API_KEY` is the Brevo transactional API key.
- `BREVO_FROM_EMAIL` is a verified sender email in Brevo.
- `WAKAJAYE_ADMIN_EMAIL` is the address permitted to review and approve receipts.

Then run `npm run dev` and open http://127.0.0.1:3000. Verification codes and approved receipts are sent through Brevo. Tenant records, sessions, and uploaded receipts are stored in the private Wakajaye schema in Supabase.

Trap by Aayush Mayank is bundled locally. Source: https://befonts.com/trap-sans-serif-font-family.html

## Vercel

Import this repository on Vercel with the Next.js framework preset and the repository root as the root directory. Add the four server environment variables above and deploy. Apply the Supabase schema before testing sign-in. Proof uploads are limited to 3 MB.
