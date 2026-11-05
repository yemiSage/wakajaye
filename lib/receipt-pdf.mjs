import PDFDocument from 'pdfkit';

const issuer = 'Adegboye Opeyemi';
const ink = '#29204D';
const muted = '#625B76';
const line = '#E7E3EF';
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos',
});

export async function receiptPdf({ number, name, email, rent }, signature) {
  const issued = rent.approvedAt ? new Date(rent.approvedAt) : null;
  const doc = new PDFDocument({
    size: 'A4', margin: 0,
    info: {
      Title: 'Wakajaye rent receipt ' + number,
      Author: issuer,
      CreationDate: issued ?? new Date(0),
    },
  });
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Body', process.cwd() + '/assets/fonts/NotoSans-Regular.ttf');
  doc.registerFont('Bold', process.cwd() + '/assets/fonts/NotoSans-Bold.ttf');

  function text(value, x, y, { width = 499, align = 'left', height, size = 11, bold = false, color = ink } = {}) {
    doc.font(bold ? 'Bold' : 'Body').fontSize(size).fillColor(color)
      .text(value, x, y, { width, align, height, ellipsis: Boolean(height) });
  }
  function rule(y) {
    doc.moveTo(48, y).lineTo(547, y).lineWidth(0.7).strokeColor(line).stroke();
  }

  text('WAKAJAYE HOSTEL', 48, 48, { bold: true, size: 12 });
  text(number, 373, 48, { width: 174, align: 'right', bold: true, size: 12 });
  text('Rent receipt', 48, 73, { bold: true, size: 32 });
  text('PAYMENT VERIFIED', 373, 95, { width: 174, align: 'right', bold: true, size: 9, color: '#19674F' });
  rule(129);

  text('ISSUED BY', 48, 151, { color: muted, size: 9, bold: true });
  text(issuer, 48, 170, { width: 154, bold: true });
  text('Wakajaye Hostel', 48, 190, { width: 154, color: muted });
  text('RECEIVED FROM', 217, 151, { color: muted, size: 9, bold: true });
  text(name || email, 217, 170, { width: 214, height: 56, bold: true });
  if (name) text(email, 217, doc.y + 5, { width: 214, height: 70, color: muted, size: 9 });
  text('ISSUE DATE', 441, 151, { width: 106, align: 'right', color: muted, size: 9, bold: true });
  text(issued ? dateFormat.format(issued) : 'Unavailable', 441, 170, { width: 106, align: 'right' });

  const amount = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(rent.amount);
  text('DESCRIPTION', 48, 322, { color: muted, size: 9, bold: true });
  text('AMOUNT', 347, 322, { width: 200, align: 'right', color: muted, size: 9, bold: true });
  rule(344);
  text('Rent payment', 48, 360);
  text(amount, 347, 360, { width: 200, align: 'right' });
  rule(387);
  doc.roundedRect(303, 404, 244, 49, 8).fill('#F4F1FA');
  text('Total received', 317, 421, { width: 92, size: 10, bold: true });
  text(amount, 407, 418, { width: 126, align: 'right', size: 14, bold: true });

  text('PAYMENT CONFIRMATION', 48, 499, { color: muted, size: 9, bold: true });
  text('Wakajaye Hostel has received and verified this rent payment.', 48, 518, { width: 310, color: muted });
  if (rent.paid) text('Payment date: ' + rent.paid, 48, 556, { width: 310, color: muted });
  doc.image(signature, 403, 490, { fit: [144, 92], align: 'center', valign: 'center' });
  doc.moveTo(403, 590).lineTo(547, 590).strokeColor(line).stroke();
  text(issuer, 403, 600, { width: 144, align: 'center', bold: true });
  text('Authorized signature', 403, 619, { width: 144, align: 'center', color: muted, size: 9 });

  text('RECEIPT', 48, 701, { size: 100, bold: true, color: '#F1EDF6', align: 'center' });
  doc.end();
  return completed;
}
