# Wakajaye

A local tenant portal modeled on [Kivo](https://github.com/yemiSage/kivo). The reference backdrop is retained with the accompanying Kivo license. Wakajaye has its own handwritten SVG wordmark.

## Run locally

Install the Python dependency and run [supabase.sql](supabase.sql) once in the SQL editor of your Wakajaye Supabase project.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Set these variables in the server environment:

- `SUPABASE_DB_URL` is the PostgreSQL connection string from the Supabase Connect dialog. Use the session pooler if your network lacks IPv6. Use the database role that owns the Wakajaye schema.
- `BREVO_API_KEY` is the Brevo transactional API key.
- `BREVO_FROM_EMAIL` is a verified sender email in Brevo.
- `WAKAJAYE_ADMIN_EMAIL` is the address permitted to review and approve receipts.

Then run `PORT=3000 python server.py` and open http://127.0.0.1:3000. Verification codes and approved receipts are sent through Brevo. Tenant records, sessions, and uploaded receipts are stored in the private Wakajaye schema in Supabase.

Trap by Aayush Mayank is bundled locally. Source: https://befonts.com/trap-sans-serif-font-family.html

## Vercel

From this directory, sign in with `npx vercel login`. Create or link the Wakajaye project with `npx vercel link`, set the four server environment variables listed above in the Vercel project, and deploy with `npx vercel --prod`. Apply the Supabase schema before testing sign-in. Proof uploads are limited to 3 MB so the encoded request fits Vercel's function payload limit.
