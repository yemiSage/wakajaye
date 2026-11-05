import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_EMAIL = 'adegboyeopeyemi065@gmail.com';
export const adminSessionAge = 3600;
export const tenantSessionAge = 604800;
export const adminActions = new Set(['admin', 'tenant', 'queue', 'file', 'approve', 'review-payment', 'email-tenant', 'delete-tenant']);
export const readActions = new Set(['session', 'receipt', 'admin', 'tenant', 'queue', 'file']);
export const writeActions = new Set(['code', 'verify', 'logout', 'profile', 'guarantor', 'consent', 'activate', 'approve', 'review-payment', 'email-tenant', 'delete-tenant']);

function secret() {
  // Domain separation gives these digests their own purpose even on existing deployments.
  const key = process.env.AUTH_SECRET || process.env.BREVO_API_KEY;
  if (!key) throw new Error('Authentication secret unavailable');
  return key;
}

export function sessionDigest(raw, adminScope = false) {
  if (!adminScope) return createHash('sha256').update(raw).digest('hex');
  return createHmac('sha256', secret()).update('wakajaye:admin-session:v1\0' + raw).digest('hex');
}

export function otpDigest(address, mode, salt, code) {
  return 'h1:' + salt + ':' + createHmac('sha256', secret())
    .update(['wakajaye:otp:v1', address, mode, salt, code].join('\0')).digest('hex');
}

export function matchesOtp(record, address, code, adminScope) {
  if (!/^\d{6}$/.test(code)) return false;
  if (adminScope ? record.mode !== 'admin' : !['create', 'signin'].includes(record.mode)) return false;
  const [version, salt, hash] = record.digest.split(':');
  if (version !== 'h1' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{64}$/.test(hash || '')) return false;
  const expected = otpDigest(address, record.mode, salt, code);
  return timingSafeEqual(Buffer.from(record.digest), Buffer.from(expected));
}

export function usesAdminSession(action, portal) {
  return adminActions.has(action) || (['session', 'verify', 'logout'].includes(action) && portal === 'admin');
}

export async function consumeAuthLimit(db, action, ip, address, now) {
  const window = 900;
  // Synthetic keys cannot collide with an email accepted by emailField.
  const keys = [
    ['ip', ip, action === 'code' ? 10 : 30],
    ['email', address, action === 'code' ? 5 : 20],
  ];
  let allowed = true;
  for (const [kind, value, limit] of keys) {
    const key = 'rate:' + action + ':' + kind + ':' + createHash('sha256').update(value).digest('hex');
    const { rows: [counter] } = await db.query(
      "INSERT INTO codes(email,digest,issued,attempts,mode) VALUES($1,'rate',$2,1,'limit') ON CONFLICT(email) DO UPDATE SET issued=CASE WHEN codes.issued<=$3 THEN $2 ELSE codes.issued END, attempts=CASE WHEN codes.issued<=$3 THEN 1 ELSE codes.attempts+1 END RETURNING attempts",
      [key, now, now-window],
    );
    if (counter.attempts > limit) allowed = false;
    if (!allowed) break;
  }
  await db.query("DELETE FROM codes WHERE mode='limit' AND issued<$1", [now-86400]);
  return allowed;
}
