import PDFDocument from 'pdfkit';
import { paymentLines } from './payment-charges.mjs';

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

  const currency = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });
  text('DESCRIPTION', 48, 312, { color: muted, size: 9, bold: true });
  text('AMOUNT', 347, 312, { width: 200, align: 'right', color: muted, size: 9, bold: true });
  rule(334);
  const lines = paymentLines(rent);
  lines.forEach(([label, amount], index) => {
    const y = 346 + index * 24;
    text(label, 48, y);
    text(currency.format(amount), 347, y, { width: 200, align: 'right' });
  });
  const totalY = Math.max(404, 356 + lines.length * 24);
  rule(totalY - 14);
  doc.roundedRect(291, totalY, 256, 49, 8).fill('#F4F1FA');
  text('Total received', 305, totalY + 17, { width: 92, size: 10, bold: true });
  text(currency.format(rent.amount), 396, totalY + 14, { width: 137, align: 'right', size: 14, bold: true });

  text('PAYMENT CONFIRMATION', 48, 529, { color: muted, size: 9, bold: true });
  text('Wakajaye Hostel has received and verified this rent payment.', 48, 548, { width: 310, color: muted });
  if (rent.paid) text('Payment date: ' + rent.paid, 48, 586, { width: 310, color: muted });
  if (signature) doc.image(signature, 403, 520, { fit: [144, 92], align: 'center', valign: 'center' });
  doc.moveTo(403, 620).lineTo(547, 620).strokeColor(line).stroke();
  text(issuer, 403, 630, { width: 144, align: 'center', bold: true });
  text('Caretaker / Landlord', 403, 649, { width: 144, align: 'center', color: muted, size: 9 });

  doc.save().fillOpacity(0.6);
  text('RECEIPT', 48, 701, { size: 100, bold: true, color: '#F1EDF6', align: 'center' });
  doc.restore();
  doc.end();
  return completed;
}
