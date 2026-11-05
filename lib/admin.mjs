function parse(value) {
  return value ? JSON.parse(value) : null;
}

export function tenantSummary(row) {
  const profile = parse(row.profile) || {};
  const rent = parse(row.rent);
  const status = paymentStatus(row.status, rent);
  return {
    email: row.email,
    name: [profile.first, profile.last].filter(Boolean).join(' ') || row.email,
    phone: profile.phone || '',
    onboardingComplete: Boolean(profile.first && profile.gender && profile.dob && row.guarantor && profile.agreement?.version === 3),
    status: status === 'verified' ? 'active' : status || 'inactive',
    rent,
    receipt: row.receipt_id ? { id: row.receipt_id, name: row.receipt_name, mime: row.mime, status, files: proofFiles(rent, row.receipt_name, row.mime) } : null,
  };
}

export async function adminData(db, params) {
  const search = (params.get('search') || '').trim().slice(0, 120);
  const filter = params.get('status') || '';
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.get('page') || '1', 10) || 1));
  const pageSize = 20;
  const { rows } = await db.query(
    'SELECT t.email,t.profile,t.guarantor,t.rent,r.id AS receipt_id,r.name AS receipt_name,r.mime,r.status FROM tenants t LEFT JOIN receipts r USING(email) ORDER BY t.email',
  );
  const all = rows.map(tenantSummary);
  const summary = {
    tenants: all.length,
    active: all.filter(tenant => tenant.status === 'active').length,
    pending: all.filter(tenant => tenant.status === 'pending').length,
    inactive: all.filter(tenant => tenant.status === 'inactive').length,
    received: all.filter(tenant => tenant.status === 'active').reduce((total, tenant) => total + (tenant.rent?.amount || 0), 0),
  };
  const results = all.filter(tenant =>
    (!filter || tenant.status === filter) &&
    (!search || (tenant.name + ' ' + tenant.email + ' ' + tenant.phone).toLowerCase().includes(search.toLowerCase())),
  );
  return {
    summary, page, pageSize, total: results.length,
    tenants: results.slice((page - 1) * pageSize, page * pageSize),
  };
}

export async function tenantDetails(db, email) {
  const { rows: [row] } = await db.query(
    'SELECT t.email,t.profile,t.guarantor,t.rent,r.id AS receipt_id,r.name AS receipt_name,r.mime,r.status FROM tenants t LEFT JOIN receipts r USING(email) WHERE t.email=$1', [email],
  );
  if (!row) return null;
  return { ...tenantSummary(row), profile: parse(row.profile) || {}, guarantor: parse(row.guarantor) };
}
import { paymentStatus, proofFiles } from './payment-proof.mjs';
