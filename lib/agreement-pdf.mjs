import PDFDocument from 'pdfkit';
import { agreementStyle } from './agreement.mjs';

export async function agreementPdf(agreement) {
  const doc = new PDFDocument({
    size: 'A4', margin: 48, bufferPages: true,
    info: { Title: 'Wakajaye Residential Tenancy Agreement', Author: 'Wakajaye' },
  });
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Body', process.cwd() + '/assets/fonts/NotoSans-Regular.ttf');
  doc.registerFont('Bold', process.cwd() + '/assets/fonts/NotoSans-Bold.ttf');
  for (const [index, paragraph] of agreement.text.trim().split(/\n\s*\n/).entries()) {
    const style = agreementStyle(paragraph, index);
    const bold = ['title', 'heading', 'payment'].includes(style);
    const size = style === 'title' ? 17 : style === 'heading' ? 11 : 9;
    const color = style === 'payment' ? '#164B9B' : style === 'warning' ? '#A52626' : '#242424';
    doc.font(bold ? 'Bold' : 'Body').fontSize(size).fillColor(color);
    const height = doc.heightOfString(paragraph, { width: 499, lineGap: 3 });
    if (doc.y + height > doc.page.height - 64) doc.addPage();
    doc.font(bold ? 'Bold' : 'Body').fontSize(size).fillColor(color);
    doc.text(paragraph, { width: 499, lineGap: 3 });
    doc.moveDown(style === 'heading' ? 0.65 : 0.85);
  }
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Body').fontSize(8).fillColor('#666666')
      .text('Wakajaye · ' + agreement.date + ' · ' + (index + 1) + ' / ' + range.count, 48, doc.page.height - 36, { width: 499, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return completed;
}
