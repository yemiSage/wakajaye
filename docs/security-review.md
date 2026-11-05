# Security review — 5 November 2026

Scope: Wakajaye source, authentication and authorization paths, receipt uploads and previews, request validation, installed dependencies, and targeted HTTP checks. This is an application review with regression tests, not an independent penetration test or a guarantee that every vulnerability has been found.

## Findings addressed

| Finding | Change |
| --- | --- |
| The administrator's tenant session could also authorize admin operations. | Pin the sole administrator to `adegboyeopeyemi065@gmail.com`. Require a separate admin email OTP, a separate HttpOnly/Secure/SameSite=Strict cookie, and a server-keyed session digest for every admin endpoint. Admin sessions expire after one hour. Existing tenant cookies cannot authorize admin requests. |
| OTP verification did not bind a code to the portal that requested it. | Bind OTP digests to email, mode and a random salt. Tenant codes cannot create admin sessions and admin codes cannot create tenant sessions. Successful verification deletes the code; expiry remains ten minutes with five incorrect guesses per code. |
| Salted hashes of six-digit codes could be brute-forced offline if the codes table leaked. | Use HMAC-SHA256 with a server-only key. A dedicated `AUTH_SECRET` can be configured; existing deployments use a purpose-separated HMAC with the existing Brevo server key. No credential is shipped to the browser. |
| Per-email cooldown alone did not limit aggregate email or verification abuse. | Durable counters in the private codes table limit requests per mailbox and source IP over fifteen minutes: code requests 5/mailbox and 10/IP; verification 20/mailbox and 30/IP. Counts commit even when later validation or mail delivery fails. Keep the thirty-second resend cooldown. |
| Tenant emails were inserted into navigation button attributes without escaping. | Escape action attributes, as well as displayed tenant fields. Add a regression case using an HTML injection payload. |
| Untrusted receipt PDFs were embedded without isolation. | Sandbox the preview iframe and file response; set no-sniff and no-store headers, encode download filenames, and require the dedicated admin session to fetch files. Existing server-side size, signature and canonical base64 checks remain enforced. |
| Requests could reach the database before basic rejection checks. | Reject unknown endpoints, unauthorized portal addresses, missing appropriate cookies, cross-site writes, malformed JSON and oversized bodies before connecting. All application SQL values remain parameterized. |
| A global advisory lock serialized unrelated users, including while waiting for Brevo. | Lock mutations by account instead. Apply database statement and lock timeouts, so one account's email request does not globally block tenant mutations. |
| Missing browser hardening headers. | Add content sniffing protection, deny page framing, restrict form targets and plugin content, and disable camera/microphone/location permissions. Preserve the inline Next.js bootstrap. |

Production IP limits use Vercel's `x-vercel-forwarded-for` header, with a fallback if absent. Local development shares one local bucket. [Vercel documents the proxy-header trust behavior](https://vercel.com/docs/headers/request-headers).

## Verification

- `npm test`: 14 checks pass, covering allowlisting, OTP delivery payloads, portal binding, single use, expiry, cookie separation, request rejection, rate-limit boundaries, malicious payment/file input, HTML escaping, agreement gating, and admin navigation.
- `npm run build`: optimized Next.js production build passes.
- `npm audit --json`: zero reported vulnerabilities across all severity levels, with 119 dependencies in the audit metadata. This measures known npm advisories only.
- Local production HTTP checks: both entry pages render, security headers and the mobile viewport are present, admin data/file/approval routes reject tenant cookies or absent admin cookies, non-admin OTP requests return 403, cross-origin writes return 403, and unknown actions return 404.
- No tracked environment files or obvious embedded Brevo keys/database URLs were found by the scoped source scan. This was a pattern scan, not credential rotation or a full history audit.

No email was sent and no tenant records were modified by the HTTP probes. Mail delivery and authenticated database behavior are covered with test doubles; a fresh production mailbox OTP flow was not completed during this review. Browser automation is disabled in the current Work settings, so this pass does not include a device screenshot review.

## Remaining limits

- Upload signature checks and sandboxing are not antivirus scanning. Downloaded files must still be treated as untrusted. Some browser PDF viewers may require using the download fallback instead of the sandboxed preview.
- The CSP does not use per-request script nonces or block inline scripts, because the existing Next.js page bootstrap is static. HTML escaping remains essential.
- Application attempt limits do not replace network-layer bot or DDoS protection. Untrusted requests can temporarily consume a mailbox's allowance. Limits persist in PostgreSQL, so attackers cannot evade them by switching application instances.
- Production Supabase grants, organization membership, Brevo account settings, Vercel account access and backup retention were not re-audited or changed in this pass. Keep the deployed database role restricted to Wakajaye's private tables.
- Rotating `AUTH_SECRET` (or the fallback Brevo key) invalidates pending OTPs and existing admin sessions. Tenant sessions retain their existing seven-day lifetime and are not promoted to admin sessions.
