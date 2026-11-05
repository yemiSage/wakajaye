import { randomBytes, randomInt } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import pg from 'pg';
import { ADMIN_EMAIL, adminActions, readActions, writeActions, usesAdminSession, sessionDigest, otpDigest, matchesOtp, consumeAuthLimit, adminSessionAge, tenantSessionAge } from '../../../lib/security.mjs';
import { adminData, tenantDetails } from '../../../lib/admin.mjs';
import supabaseCA from './supabase-ca';
import { agreementForDate, agreementVersion } from '../../../lib/agreement.mjs';
import { amountInKobo, fixedPaymentCharges, maxPaymentKobo, paymentLines } from '../../../lib/payment-charges.mjs';
import { maxImageProofBytes, maxProofBytes, maxProofFiles, paymentStatus, proofAt, proofFiles } from '../../../lib/payment-proof.mjs';

export const runtime = 'nodejs';

let pool;

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function field(data, name, max = 120) {
  const value = typeof data[name] === 'string' ? data[name].trim() : '';
  if (!value || value.length > max || [...value].some(char => char.charCodeAt(0) < 32)) {
    throw new RequestError('Enter a valid ' + name + '.');
  }
  return value;
}

function messageField(data, name, max) {
  const value = typeof data[name] === 'string' ? data[name].trim() : '';
  if (!value || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new RequestError('Enter a valid ' + name + ' of up to ' + max.toLocaleString('en-NG') + ' characters.');
  }
  return value;
}

function emailField(data) {
  const email = field(data, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError('Enter a valid email address.');
  }
  return email;
}

function dateField(data, name) {
  const value = field(data, name, 10);
  const date = new Date(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) {
    throw new RequestError('Enter a valid date.');
  }
  return value;
}

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function sendMail(email, subject, textContent, attachment) {
  const key = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_FROM_EMAIL;
  if (!key || !sender) throw new RequestError('Email delivery is unavailable.', 503);
  const payload = { sender: { name: 'Wakajaye', email: sender }, to: [{ email }], subject, textContent };
  if (attachment) {
    payload.attachment = [{ name: attachment.name, content: attachment.bytes.toString('base64') }];
  }
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 201) return;
  } catch {
    // Send the same user-facing error for connection failures and provider rejections.
  }
  throw new RequestError('Email delivery failed. Try again.', 502);
}

function tenantName(profile) {
  return [profile.first, profile.last].filter(Boolean).join(' ');
}

function receiptNumber(id) {
  return 'WJ-' + String(id).padStart(6, '0');
}

async function officialReceipt(id, tenant, rent) {
  const number = receiptNumber(id);
  const name = rent.issuedTo ?? tenantName(tenant);
  const encodedSignature = process.env.RECEIPT_SIGNATURE_BASE64;
  if (!encodedSignature) {
    // Preserve the existing text receipt until the private signing asset is configured.
    const amount = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const text = [
      'WAKAJAYE HOSTEL',
      'Official rent receipt ' + number,
      '',
      'Tenant: ' + name,
      ...(rent.paid ? ['Payment date: ' + rent.paid] : []),
      ...(rent.charges ? paymentLines(rent).map(([label, value]) => label + ': NGN ' + amount.format(value)) : []),
      'Amount received: NGN ' + amount.format(rent.amount),
    ].join('\n');
    return { name: 'wakajaye-receipt-' + number + '.txt', bytes: Buffer.from(text), type: 'text/plain; charset=utf-8' };
  }
  const signature = Buffer.from(encodedSignature, 'base64');
  if (signature.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new RequestError('The receipt signature has not been configured.', 503);
  }
  const { receiptPdf } = await import('../../../lib/receipt-pdf.mjs');
  const bytes = await receiptPdf({ number, name, email: tenant.email, rent }, signature);
  return { name: 'wakajaye-receipt-' + number + '.pdf', bytes, type: 'application/pdf' };
}

async function loadUser(db, email, admin) {
  if (!email) return null;
  const { rows: [tenant] } = await db.query(
    'SELECT t.profile,t.guarantor,t.rent,r.id AS receipt_id,r.name AS receipt_name,r.mime AS receipt_mime,octet_length(r.bytes) AS receipt_size,r.status AS receipt_status FROM tenants t LEFT JOIN receipts r USING(email) WHERE t.email=$1', [email],
  );
  if (!tenant) return null;
  const rent = JSON.parse(tenant.rent || 'null');
  const receipt = tenant.receipt_status ? {
    name: tenant.receipt_name,
    status: paymentStatus(tenant.receipt_status, rent),
    files: proofFiles(rent, tenant.receipt_name, tenant.receipt_mime, tenant.receipt_size),
    ...(tenant.receipt_status === 'verified' ? { number: receiptNumber(tenant.receipt_id) } : {}),
  } : null;
  return {
    ...JSON.parse(tenant.profile || '{}'),
    email,
    admin: email === admin,
    guarantor: Boolean(tenant.guarantor),
    rent,
    receipt: receipt ?? null,
  };
}

async function read(db, request, action, email, admin) {
  if (action === 'session') return json({ user: await loadUser(db, email, admin) });
  if (action === 'receipt') {
    if (!email) throw new RequestError('Sign in to download your receipt.', 401);
    const { rows: [record] } = await db.query(
      "SELECT r.id,t.profile,t.rent FROM receipts r JOIN tenants t USING(email) WHERE r.email=$1 AND r.status='verified'", [email],
    );
    if (!record) throw new RequestError('No issued receipt is available.', 404);
    const tenant = { ...JSON.parse(record.profile || '{}'), email };
    const attachment = await officialReceipt(record.id, tenant, JSON.parse(record.rent));
    return new Response(attachment.bytes, { headers: {
      'Content-Type': attachment.type,
      'Content-Disposition': 'attachment; filename="' + attachment.name + '"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  }
  if (!email || email !== admin) throw new RequestError('Admin access required.', 403);
  if (action === 'admin') return json(await adminData(db, request.nextUrl.searchParams));
  if (action === 'tenant') {
    const tenant = await tenantDetails(db, request.nextUrl.searchParams.get('email') || '');
    if (!tenant) throw new RequestError('Tenant not found.', 404);
    return json({ tenant });
  }
  if (action === 'queue') {
    const { rows } = await db.query("SELECT r.id, r.email, t.rent FROM receipts r JOIN tenants t USING(email) WHERE r.status='pending'");
    return json({ queue: rows.flatMap(({ id, email, rent }) => {
      const payment = JSON.parse(rent);
      return paymentStatus('pending', payment) === 'pending' ? [{ id, email, amount: payment.amount, paid: payment.paid }] : [];
    }) });
  }
  if (action === 'file') {
    const id = request.nextUrl.searchParams.get('id');
    if (!id || !/^\d{1,18}$/.test(id)) throw new RequestError('Receipt not found.', 404);
    const index = request.nextUrl.searchParams.get('index') ?? '0';
    if (!/^[0-4]$/.test(index)) throw new RequestError('Proof not found.', 404);
    const { rows: [stored] } = await db.query('SELECT r.name,r.mime,r.bytes,t.rent FROM receipts r JOIN tenants t USING(email) WHERE r.id=$1', [id]);
    const file = stored && proofAt(stored.bytes, proofFiles(JSON.parse(stored.rent || 'null'), stored.name, stored.mime, stored.bytes.length), Number(index));
    if (!file) throw new RequestError('Receipt not found.', 404);
    const name = encodeURIComponent(file.name).replace(/'/g, '%27');
    return new Response(file.bytes, { headers: {
      'Content-Type': file.mime,
      'Content-Disposition': (request.nextUrl.searchParams.get('preview') === '1' ? 'inline' : 'attachment') + "; filename*=UTF-8''" + name,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'",
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'no-store',
    } });
  }
  throw new RequestError('Not found.', 404);
}

function decodeProof(data) {
  if (!data || typeof data !== 'object') throw new RequestError('Choose a valid proof file.');
  const name = field(data, 'name', 240).split(/[\\/]/).at(-1);
  const encoded = field(data, 'file', 4_250_000);
  const bytes = Buffer.from(encoded, 'base64');
  const signatures = [['255044462d', 'application/pdf'], ['ffd8ff', 'image/jpeg'], ['89504e470d0a1a0a', 'image/png']];
  const magic = bytes.subarray(0, 8).toString('hex');
  const mime = signatures.find(([prefix]) => magic.startsWith(prefix))?.[1];
  if (!name || !mime || bytes.length > maxProofBytes || bytes.toString('base64') !== encoded) {
    throw new RequestError('Choose a PDF, JPG, or PNG up to 3 MB.');
  }
  if (mime.startsWith('image/') && bytes.length > maxImageProofBytes) {
    throw new RequestError('Images must be compressed to 1 MB or less before uploading. Add the image again.');
  }
  return { name, mime, size: bytes.length, bytes };
}

async function readProofSubmission(db, data, current) {
  const entries = data.proofs ?? [data];
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > maxProofFiles) {
    throw new RequestError('Add between one and five proof files.');
  }
  let stored;
  if (entries.some(entry => entry?.keep !== undefined) && current.receipt) {
    const result = await db.query('SELECT bytes FROM receipts WHERE email=$1', [current.email]);
    stored = result.rows[0]?.bytes;
  }
  const kept = new Set();
  const files = entries.map(entry => {
    if (entry?.keep === undefined) return decodeProof(entry);
    const index = entry.keep;
    const proof = stored && Number.isInteger(index) && index >= 0 && proofAt(stored, current.receipt.files, index);
    if (!proof || kept.has(index)) throw new RequestError('One of the original proof files could not be kept. Refresh and try again.');
    kept.add(index);
    return proof;
  });
  if (files.reduce((total, file) => total + file.size, 0) > maxProofBytes) {
    throw new RequestError('Proof files must be 3 MB or less in total.');
  }
  return files;
}

async function mutate(db, action, data, email, admin, token, secure, adminScope = false, onRegistration = () => {}) {
  const now = Date.now() / 1000;
  if (action === 'code') {
    const address = emailField(data);
    if (!['create', 'signin'].includes(data.mode)) throw new RequestError('Invalid sign-in request.');
    if (data.portal === 'admin' && address !== admin) throw new RequestError('Admin access required.', 403);
    const codeMode = data.portal === 'admin' ? 'admin' : data.mode;
    const { rows: [previous] } = await db.query('SELECT issued FROM codes WHERE email=$1', [address]);
    if (previous && now - previous.issued < 30) throw new RequestError('Wait 30 seconds before requesting another code.', 429);
    const code = String(randomInt(100000, 1000000));
    const salt = randomBytes(16).toString('hex');
    await db.query(
      'INSERT INTO codes VALUES($1,$2,$3,0,$4) ON CONFLICT (email) DO UPDATE SET digest=excluded.digest, issued=excluded.issued, attempts=0, mode=excluded.mode',
      [address, otpDigest(address, codeMode, salt, code), now, codeMode],
    );
    await sendMail(address, 'Your Wakajaye verification code', 'Your Wakajaye code is ' + code + '. It expires in 10 minutes.');
    return json({ ok: true });
  }

  if (action === 'verify') {
    const address = emailField(data);
    const code = field(data, 'code', 6);
    if (data.portal === 'admin' && address !== admin) throw new RequestError('Admin access required.', 403);
    const { rows: [record] } = await db.query('SELECT * FROM codes WHERE email=$1', [address]);
    if (!record || now - record.issued > 600 || record.attempts >= 5) throw new RequestError('Request a fresh code.');
    const isAdminLogin = data.portal === 'admin';
    if (!matchesOtp(record, address, code, isAdminLogin)) {
      await db.query('UPDATE codes SET attempts=attempts+1 WHERE email=$1', [address]);
      return json({ error: 'That code does not match.' }, 400);
    }
    if (record.mode === 'signin' && !await loadUser(db, address, admin)) {
      throw new RequestError('No account yet. Choose Create an account.');
    }
    await db.query('DELETE FROM codes WHERE email=$1', [address]);
    const inserted = await db.query('INSERT INTO tenants(email) VALUES($1) ON CONFLICT (email) DO NOTHING', [address]);
    if (inserted.rowCount === 1 && record.mode === 'create') onRegistration(address);
    await db.query('DELETE FROM sessions WHERE token=$1 OR expires<$2', [token, now]);
    const session = randomBytes(32).toString('base64url');
    const sessionAge = isAdminLogin ? adminSessionAge : tenantSessionAge;
    await db.query('INSERT INTO sessions VALUES($1,$2,$3)', [sessionDigest(session, isAdminLogin), address, now + sessionAge]);
    const response = json({ user: await loadUser(db, address, isAdminLogin ? admin : undefined) });
    response.cookies.set(isAdminLogin ? 'wj_admin' : 'wj', session, { httpOnly: true, sameSite: 'strict', path: '/', secure, maxAge: sessionAge });
    return response;
  }

  if (!email) throw new RequestError('Sign in to continue.', 401);
  if (action === 'logout') {
    await db.query('DELETE FROM sessions WHERE token=$1', [token]);
    const response = json({ ok: true });
    response.cookies.set(adminScope ? 'wj_admin' : 'wj', '', { httpOnly: true, sameSite: 'strict', path: '/', secure, maxAge: 0 });
    return response;
  }

  const current = await loadUser(db, email, admin);
  if (!current) throw new RequestError('Sign in to continue.', 401);
  switch (action) {
    case 'profile': {
      const dob = dateField(data, 'dob');
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Lagos' });
      const gender = field(data, 'gender', 40);
      if (dob >= today) throw new RequestError('Enter a date of birth in the past.');
      if (!['Female', 'Male', 'Non-binary', 'Prefer not to say'].includes(gender)) {
        throw new RequestError('Choose a gender option.');
      }
      const { rows: [tenant] } = await db.query('SELECT profile FROM tenants WHERE email=$1', [email]);
      const profile = {
        ...JSON.parse(tenant.profile || '{}'),
        first: field(data, 'first', 80),
        last: field(data, 'last', 80),
        phone: field(data, 'phone', 30),
        gender,
        dob,
      };
      await db.query('UPDATE tenants SET profile=$1 WHERE email=$2', [JSON.stringify(profile), email]);
      break;
    }
    case 'guarantor': {
      if (!current.first || !current.gender || !current.dob) throw new RequestError('Complete your profile first.', 403);
      const guarantorEmail = typeof data.email === 'string' ? data.email.trim() : data.email;
      const guarantor = {
        name: field(data, 'name'),
        relationship: field(data, 'relationship'),
        phone: field(data, 'phone', 30),
        email: guarantorEmail == null || guarantorEmail === '' ? null : emailField({ email: guarantorEmail }),
      };
      await db.query('UPDATE tenants SET guarantor=$1 WHERE email=$2', [JSON.stringify(guarantor), email]);
      break;
    }
    case 'consent': {
      if (!current.first || !current.gender || !current.dob || !current.guarantor) {
        throw new RequestError('Complete your personal and guarantor details first.', 403);
      }
      if (data.consent !== 'on') throw new RequestError('Agree to the tenant consent terms.');
      if (String(data.agreementVersion) !== String(agreementVersion)) {
        throw new RequestError('Reload the page to read the latest agreement.');
      }
      const { rows: [tenant] } = await db.query('SELECT profile FROM tenants WHERE email=$1', [email]);
      const profile = JSON.parse(tenant.profile);
      const now = new Date();
      const agreement = agreementForDate(now);
      if (data.agreementDate !== agreement.date) throw new RequestError('The date has changed. Reload to read the current agreement.');
      profile.agreement = { version: agreement.version, date: agreement.date, sha256: agreement.sha256, acceptedAt: now.toISOString() };
      await db.query('UPDATE tenants SET profile=$1 WHERE email=$2', [JSON.stringify(profile), email]);
      break;
    }
    case 'activate': {
      if (!current.guarantor || current.agreement?.version !== agreementVersion || current.receipt?.status === 'verified') {
        throw new RequestError('This action is unavailable.', 403);
      }
      if (current.receipt && (data.submittedAt ?? null) !== (current.rent?.submittedAt ?? null)) {
        throw new RequestError('This submission has changed. Refresh and try again.', 409);
      }
      let charges;
      let totalKobo;
      if (data.amount !== undefined || data.charges === undefined) {
        totalKobo = amountInKobo(data.amount);
      } else {
        if (!data.charges || typeof data.charges !== 'object' || Array.isArray(data.charges)) {
          throw new RequestError('Enter valid amounts for each payment charge.');
        }
        const houseRentKobo = amountInKobo(data.charges.houseRent);
        if (houseRentKobo === null || houseRentKobo === 0) {
          throw new RequestError('Enter a valid amount for house rent.');
        }
        totalKobo = houseRentKobo;
      }
      if (totalKobo === null || totalKobo < 1 || totalKobo > maxPaymentKobo) {
        throw new RequestError('Enter a valid payment amount.');
      }
      charges = { ...fixedPaymentCharges };
      const files = await readProofSubmission(db, data, current);
      const proofs = files.map(({ name, mime, size }) => ({ name, mime, size }));
      const rent = { amount: totalKobo / 100, ...(charges ? { charges } : {}), proofs, submittedAt: new Date().toISOString() };
      await db.query('UPDATE tenants SET rent=$1 WHERE email=$2', [JSON.stringify(rent), email]);
      await db.query("INSERT INTO receipts(email,name,mime,bytes,status) VALUES($1,$2,$3,$4,'pending') ON CONFLICT (email) DO UPDATE SET name=excluded.name,mime=excluded.mime,bytes=excluded.bytes,status=excluded.status",
        [email, proofs[0].name, proofs[0].mime, Buffer.concat(files.map(file => file.bytes))]);
      break;
    }
    case 'review-payment':
    case 'approve': {
      if (email !== admin) throw new RequestError('Admin access required.', 403);
      if (!Number.isSafeInteger(data.id) || data.id < 1) throw new RequestError('Receipt not found.', 404);
      const { rows: [receipt] } = await db.query("SELECT id, email FROM receipts WHERE id=$1 AND status='pending'", [data.id]);
      if (!receipt) throw new RequestError('This receipt is no longer waiting for review.', 404);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [receipt.email]);
      const tenant = await loadUser(db, receipt.email, admin);
      if (tenant?.receipt?.status !== 'pending') throw new RequestError('This receipt is no longer waiting for review.', 404);
      if ((data.submittedAt ?? null) !== (tenant.rent.submittedAt ?? null)) {
        throw new RequestError('The tenant updated this submission. Reopen it to review the latest version.', 409);
      }
      if (action === 'review-payment') {
        if (!['correction', 'rejected'].includes(data.decision)) throw new RequestError('Choose a review decision.');
        const reason = messageField(data, 'reason', 1000);
        const rent = { ...tenant.rent, review: { status: data.decision, reason, at: new Date().toISOString() } };
        await db.query('UPDATE tenants SET rent=$1 WHERE email=$2', [JSON.stringify(rent), receipt.email]);
        break;
      }
      const rent = {
        ...tenant.rent,
        approvedAt: new Date().toISOString(),
        approvedBy: email,
        issuedTo: tenantName(tenant),
      };
      const attachment = await officialReceipt(receipt.id, tenant, rent);
      const receiptDescription = attachment.type === 'application/pdf' ? 'signed PDF receipt' : 'official receipt';
      await sendMail(receipt.email, 'Your official Wakajaye rent receipt',
        'Your rent payment has been verified. Your ' + receiptDescription +
        ' is attached and available under Receipts in your Wakajaye dashboard.', attachment);
      await db.query('UPDATE tenants SET rent=$1 WHERE email=$2', [JSON.stringify(rent), receipt.email]);
      await db.query("UPDATE receipts SET status='verified' WHERE id=$1", [receipt.id]);
      break;
    }
    case 'email-tenant': {
      if (email !== admin) throw new RequestError('Admin access required.', 403);
      const target = emailField(data);
      const { rowCount } = await db.query('SELECT 1 FROM tenants WHERE email=$1', [target]);
      if (!rowCount) throw new RequestError('Tenant not found.', 404);
      const subject = field(data, 'subject', 120);
      const message = messageField(data, 'message', 5000);
      await sendMail(target, subject, message);
      return json({ ok: true });
    }
    case 'delete-tenant': {
      if (email !== admin) throw new RequestError('Admin access required.', 403);
      const target = emailField(data);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [target]);
      await db.query('DELETE FROM receipts WHERE email=$1', [target]);
      await db.query('DELETE FROM sessions WHERE email=$1', [target]);
      await db.query('DELETE FROM codes WHERE email=$1', [target]);
      const result = await db.query('DELETE FROM tenants WHERE email=$1', [target]);
      if (!result.rowCount) throw new RequestError('Tenant not found.', 404);
      return json({ ok: true });
    }
    default:
      throw new RequestError('Not found.', 404);
  }
  return json({ user: await loadUser(db, email, adminScope ? admin : undefined) });
}

async function handle(request, { params }) {
  let db;
  try {
    const { action } = await params;
    const write = request.method === 'POST';
    if (!(write ? writeActions : readActions).has(action)) throw new RequestError('Not found.', 404);

    let data;
    const protocol = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.slice(0, -1);
    const host = request.headers.get('host') ?? request.nextUrl.host;
    if (write) {
      if (request.headers.get('sec-fetch-site') === 'cross-site' ||
          request.headers.get('origin') !== protocol + '://' + host ||
          request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
        throw new RequestError('Request origin is not allowed.', 403);
      }
      const maxBody = 4_300_000;
      if (Number(request.headers.get('content-length')) > maxBody) throw new RequestError('Invalid request size.', 413);
      const reader = request.body?.getReader();
      if (!reader) throw new RequestError('Invalid request.');
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBody) {
          await reader.cancel();
          throw new RequestError('Invalid request size.', 413);
        }
        chunks.push(value);
      }
      try {
        data = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw new RequestError('Invalid request.');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new RequestError('Invalid request.');
    }

    const portal = write ? data.portal : request.nextUrl.searchParams.get('portal');
    const adminScope = usesAdminSession(action, portal);
    const rawToken = request.cookies.get(adminScope ? 'wj_admin' : 'wj')?.value;
    const validToken = typeof rawToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(rawToken);
    const token = validToken ? sessionDigest(rawToken, adminScope) : '';
    if (!write && action === 'session' && !token) return json({ user: null });
    if (action === 'receipt' && !token) throw new RequestError('Sign in to download your receipt.', 401);
    if ((adminActions.has(action) || (write && !['code','verify'].includes(action))) && !token) {
      throw new RequestError(adminScope ? 'Admin sign-in required.' : 'Sign in to continue.', adminScope ? 403 : 401);
    }
    let address;
    if (write && ['code','verify'].includes(action)) {
      address = emailField(data);
      if (portal === 'admin' && address !== ADMIN_EMAIL) throw new RequestError('Admin access required.', 403);
      if (action === 'verify' && !/^\d{6}$/.test(field(data, 'code', 6))) throw new RequestError('Enter a six-digit code.');
    }

    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) throw new RequestError('The tenant database is unavailable.', 503);
    pool ??= new pg.Pool({ connectionString, ssl: { ca: supabaseCA, rejectUnauthorized: true }, connectionTimeoutMillis: 5000, max: 4 });
    db = await pool.connect();
    await db.query('BEGIN');
    await db.query('SET LOCAL search_path TO wakajaye, pg_catalog');
    await db.query("SET LOCAL statement_timeout = '10s'");
    await db.query("SET LOCAL lock_timeout = '3s'");
    if (address) {
      const ip = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown' : 'local';
      const allowed = await consumeAuthLimit(db, action, ip, address, Date.now()/1000);
      // Commit rate counters even when the later request is invalid or email delivery fails.
      await db.query('COMMIT');
      if (!allowed) throw new RequestError('Too many attempts. Please try again in 15 minutes.', 429);
      await db.query('BEGIN');
      await db.query('SET LOCAL search_path TO wakajaye, pg_catalog');
      await db.query("SET LOCAL statement_timeout = '10s'");
      await db.query("SET LOCAL lock_timeout = '3s'");
    }
    const { rows: [session] } = await db.query('SELECT email FROM sessions WHERE token=$1 AND expires>$2', [token, Date.now() / 1000]);
    const email = session?.email;
    const admin = ADMIN_EMAIL;
    if (adminScope && action !== 'verify' && email !== admin) throw new RequestError('Admin sign-in required.', 403);
    if (write) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [address || email || 'anonymous']);
    let registeredEmail;
    const response = write
      ? await mutate(db, action, data, email, admin, token, protocol === 'https', adminScope, address => { registeredEmail = address; })
      : await read(db, request, action, email, adminScope ? admin : undefined);
    await db.query('COMMIT');
    if (registeredEmail) {
      after(async () => {
        try {
          await sendMail(ADMIN_EMAIL, 'New Wakajaye tenant registration',
            'A new tenant verified their email and registered on Wakajaye.\n\nTenant email: ' + registeredEmail);
        } catch (error) {
          console.error('Wakajaye registration notification failed', error.status ?? error.name);
        }
      });
    }
    return response;
  } catch (error) {
    if (db) await db.query('ROLLBACK').catch(() => {});
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error('Wakajaye API operation failed', error.code ?? error.name);
    return json({ error: 'The tenant database is unavailable.' }, 503);
  } finally {
    db?.release();
  }
}

export { handle as GET, handle as POST };
