import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import pg from 'pg';
import supabaseCA from './supabase-ca';

export const runtime = 'nodejs';

const maxFileSize = 3 * 1024 ** 2;
const sessionAge = 604800;
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

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function sendMail(email, subject, textContent, receipt) {
  const key = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_FROM_EMAIL;
  if (!key || !sender) throw new RequestError('Email delivery is unavailable.', 503);
  const payload = { sender: { name: 'Wakajaye', email: sender }, to: [{ email }], subject, textContent };
  if (receipt) {
    payload.attachment = [{ name: 'wakajaye-rent-receipt.txt', content: Buffer.from(receipt).toString('base64') }];
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

async function loadUser(db, email, admin) {
  if (!email) return null;
  const { rows: [tenant] } = await db.query('SELECT profile, guarantor, rent FROM tenants WHERE email=$1', [email]);
  if (!tenant) return null;
  const { rows: [receipt] } = await db.query('SELECT name, status FROM receipts WHERE email=$1', [email]);
  return {
    ...JSON.parse(tenant.profile || '{}'),
    email,
    admin: email === admin,
    guarantor: Boolean(tenant.guarantor),
    rent: JSON.parse(tenant.rent || 'null'),
    receipt: receipt ?? null,
  };
}

async function read(db, request, action, email, admin) {
  if (action === 'session') return json({ user: await loadUser(db, email, admin) });
  if (!email || email !== admin) throw new RequestError('Admin access required.', 403);
  if (action === 'queue') {
    const { rows } = await db.query("SELECT r.id, r.email, t.rent FROM receipts r JOIN tenants t USING(email) WHERE r.status='pending'");
    return json({ queue: rows.map(({ id, email, rent }) => {
      const { amount, paid } = JSON.parse(rent);
      return { id, email, amount, paid };
    }) });
  }
  if (action === 'file') {
    const id = request.nextUrl.searchParams.get('id');
    if (!id || !/^\d{1,18}$/.test(id)) throw new RequestError('Receipt not found.', 404);
    const { rows: [file] } = await db.query('SELECT name, mime, bytes FROM receipts WHERE id=$1', [id]);
    if (!file) throw new RequestError('Receipt not found.', 404);
    const name = encodeURIComponent(file.name).replace(/'/g, '%27');
    return new Response(file.bytes, { headers: {
      'Content-Type': file.mime,
      'Content-Disposition': "attachment; filename*=UTF-8''" + name,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    } });
  }
  throw new RequestError('Not found.', 404);
}

async function mutate(db, action, data, email, admin, token, secure) {
  const now = Date.now() / 1000;
  if (action === 'code') {
    const address = emailField(data);
    if (!['create', 'signin'].includes(data.mode)) throw new RequestError('Invalid sign-in request.');
    const { rows: [previous] } = await db.query('SELECT issued FROM codes WHERE email=$1', [address]);
    if (previous && now - previous.issued < 30) throw new RequestError('Wait 30 seconds before requesting another code.', 429);
    const code = String(randomInt(100000, 1000000));
    const salt = randomBytes(16).toString('hex');
    await db.query(
      'INSERT INTO codes VALUES($1,$2,$3,0,$4) ON CONFLICT (email) DO UPDATE SET digest=excluded.digest, issued=excluded.issued, attempts=0, mode=excluded.mode',
      [address, salt + ':' + digest(salt + code), now, data.mode],
    );
    await sendMail(address, 'Your Wakajaye verification code', 'Your Wakajaye code is ' + code + '. It expires in 10 minutes.');
    return json({ ok: true });
  }

  if (action === 'verify') {
    const address = emailField(data);
    const code = field(data, 'code', 6);
    const { rows: [record] } = await db.query('SELECT * FROM codes WHERE email=$1', [address]);
    if (!record || now - record.issued > 600 || record.attempts >= 5) throw new RequestError('Request a fresh code.');
    const [salt, expected] = record.digest.split(':');
    if (!timingSafeEqual(Buffer.from(digest(salt + code)), Buffer.from(expected))) {
      await db.query('UPDATE codes SET attempts=attempts+1 WHERE email=$1', [address]);
      return json({ error: 'That code does not match.' }, 400);
    }
    if (record.mode === 'signin' && !await loadUser(db, address, admin)) {
      throw new RequestError('No account yet. Choose Create an account.');
    }
    await db.query('DELETE FROM codes WHERE email=$1', [address]);
    await db.query('INSERT INTO tenants(email) VALUES($1) ON CONFLICT (email) DO NOTHING', [address]);
    await db.query('DELETE FROM sessions WHERE token=$1 OR expires<$2', [token, now]);
    const session = randomBytes(32).toString('base64url');
    await db.query('INSERT INTO sessions VALUES($1,$2,$3)', [digest(session), address, now + sessionAge]);
    const response = json({ user: await loadUser(db, address, admin) });
    response.cookies.set('wj', session, { httpOnly: true, sameSite: 'strict', path: '/', secure, maxAge: sessionAge });
    return response;
  }

  if (!email) throw new RequestError('Sign in to continue.', 401);
  if (action === 'logout') {
    await db.query('DELETE FROM sessions WHERE token=$1', [token]);
    const response = json({ ok: true });
    response.cookies.set('wj', '', { httpOnly: true, sameSite: 'strict', path: '/', secure, maxAge: 0 });
    return response;
  }

  const current = await loadUser(db, email, admin);
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
      const email = typeof data.email === 'string' ? data.email.trim() : data.email;
      const guarantor = {
        name: field(data, 'name'),
        relationship: field(data, 'relationship'),
        phone: field(data, 'phone', 30),
        email: email == null || email === '' ? null : emailField({ email }),
      };
      await db.query('UPDATE tenants SET guarantor=$1 WHERE email=$2', [JSON.stringify(guarantor), email]);
      break;
    }
    case 'consent': {
      if (!current.first || !current.gender || !current.dob || !current.guarantor) {
        throw new RequestError('Complete your personal and guarantor details first.', 403);
      }
      if (data.consent !== 'on') throw new RequestError('Agree to the tenant consent terms.');
      const { rows: [tenant] } = await db.query('SELECT profile FROM tenants WHERE email=$1', [email]);
      const profile = JSON.parse(tenant.profile);
      profile.agreement = { version: 1, acceptedAt: new Date().toISOString() };
      await db.query('UPDATE tenants SET profile=$1 WHERE email=$2', [JSON.stringify(profile), email]);
      break;
    }
    case 'activate': {
      if (!current.guarantor || !current.agreement || current.receipt) {
        throw new RequestError('This action is unavailable.', 403);
      }
      const amountText = field(data, 'amount', 20);
      const amount = Number(amountText);
      if (!/^\d+(\.\d{1,2})?$/.test(amountText) || amount < 0.01 || amount > 1e9) {
        throw new RequestError('Enter a valid payment amount.');
      }
      const name = field(data, 'name', 240).split(/[\\/]/).at(-1);
      const encoded = field(data, 'file', 4_250_000);
      const bytes = Buffer.from(encoded, 'base64');
      const signatures = [['255044462d', 'application/pdf'], ['ffd8ff', 'image/jpeg'], ['89504e470d0a1a0a', 'image/png']];
      const signature = bytes.subarray(0, 8).toString('hex');
      const mime = signatures.find(([magic]) => signature.startsWith(magic))?.[1];
      if (!name || !mime || bytes.length > maxFileSize || bytes.toString('base64') !== encoded) {
        throw new RequestError('Choose a PDF, JPG, or PNG up to 3 MB.');
      }
      const rent = { ...current.rent, amount, submittedAt: new Date().toISOString() };
      await db.query('UPDATE tenants SET rent=$1 WHERE email=$2', [JSON.stringify(rent), email]);
      await db.query("INSERT INTO receipts(email,name,mime,bytes,status) VALUES($1,$2,$3,$4,'pending')", [email, name, mime, bytes]);
      break;
    }
    case 'approve': {
      if (email !== admin) throw new RequestError('Admin access required.', 403);
      if (!Number.isSafeInteger(data.id) || data.id < 1) throw new RequestError('Receipt not found.', 404);
      const { rows: [receipt] } = await db.query("SELECT id, email FROM receipts WHERE id=$1 AND status='pending'", [data.id]);
      if (!receipt) throw new RequestError('This receipt is no longer waiting for review.', 404);
      const tenant = await loadUser(db, receipt.email, admin);
      const amount = tenant.rent.amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const text = [
        'WAKAJAYE HOSTEL',
        'Official rent receipt WJ-' + String(receipt.id).padStart(6, '0'),
        '',
        'Tenant: ' + tenant.first + ' ' + tenant.last,
        ...(tenant.rent.paid ? ['Payment date: ' + tenant.rent.paid] : []),
        'Amount received: NGN ' + amount,
      ].join('\n');
      await sendMail(receipt.email, 'Your official Wakajaye rent receipt', 'Your rent payment has been verified. Your official receipt is attached.', text);
      await db.query("UPDATE receipts SET status='verified' WHERE id=$1", [receipt.id]);
      break;
    }
    default:
      throw new RequestError('Not found.', 404);
  }
  return json({ user: await loadUser(db, email, admin) });
}

async function handle(request, { params }) {
  let db;
  try {
    const { action } = await params;
    const rawToken = request.cookies.get('wj')?.value;
    const token = rawToken ? digest(rawToken) : '';
    const write = request.method === 'POST';
    if (!write && action === 'session' && !token) return json({ user: null });

    let data;
    const protocol = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.slice(0, -1);
    const host = request.headers.get('host') ?? request.nextUrl.host;
    if (write) {
      if (request.headers.get('origin') !== protocol + '://' + host ||
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

    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) throw new RequestError('The tenant database is unavailable.', 503);
    pool ??= new pg.Pool({ connectionString, ssl: { ca: supabaseCA, rejectUnauthorized: true }, connectionTimeoutMillis: 5000, max: 4 });
    db = await pool.connect();
    await db.query('BEGIN');
    await db.query('SET LOCAL search_path TO wakajaye, pg_catalog');
    if (write) await db.query('SELECT pg_advisory_xact_lock(73201300)');
    const { rows: [session] } = await db.query('SELECT email FROM sessions WHERE token=$1 AND expires>$2', [token, Date.now() / 1000]);
    const email = session?.email;
    const admin = process.env.WAKAJAYE_ADMIN_EMAIL?.trim().toLowerCase();
    const response = write
      ? await mutate(db, action, data, email, admin, token, protocol === 'https')
      : await read(db, request, action, email, admin);
    await db.query('COMMIT');
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
