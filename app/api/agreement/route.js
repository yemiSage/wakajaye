import { agreementForDate } from '../../../lib/agreement.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const today = agreementForDate();
  const requestedDate = request.nextUrl.searchParams.get('date');
  let agreement = today;
  if (requestedDate) {
    const parsed = new Date(requestedDate + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !Number.isFinite(+parsed) ||
        parsed.toISOString().slice(0, 10) !== requestedDate || requestedDate > today.date) {
      return Response.json({ error: 'Invalid agreement date.' }, { status: 400 });
    }
    agreement = agreementForDate(parsed);
  }
  if (request.nextUrl.searchParams.get('format') !== 'pdf') {
    return Response.json(agreement, { headers: { 'Cache-Control': 'no-store' } });
  }
  const { agreementPdf } = await import('../../../lib/agreement-pdf.mjs');
  const pdf = await agreementPdf(agreement);
  return new Response(pdf, { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="wakajaye-tenancy-agreement-' + agreement.date + '.pdf"',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}
