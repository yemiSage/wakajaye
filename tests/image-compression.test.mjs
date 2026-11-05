import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareProofFiles } from '../lib/image-compression.mjs';
import { maxImageInputBytes, maxImageProofBytes, maxProofBytes } from '../lib/payment-proof.mjs';

test('proof preparation preserves images already below 1 MB and existing proofs', async () => {
  const image = new File([Buffer.alloc(maxImageProofBytes)], 'proof.jpg', {type:'image/jpeg'});
  const saved = {keep:0,name:'original.png',mime:'image/png',size:2*maxImageProofBytes};
  assert.deepEqual(await prepareProofFiles([saved,image]),[saved,image]);
});

test('proof preparation rejects images over 10 MB, empty or unsupported files, and more than five proofs', async () => {
  const oversized = new File([Buffer.alloc(maxImageInputBytes+1)],'large.png',{type:'image/png'});
  await assert.rejects(prepareProofFiles([oversized]),/up to 10 MB/);
  await assert.rejects(prepareProofFiles([new File([],'empty.jpg',{type:'image/jpeg'})]),/up to 10 MB/);
  await assert.rejects(prepareProofFiles([new File(['text'],'proof.txt')]),/PDF or image/);
  const pdf = new File(['%PDF-1.7'],'proof.pdf',{type:'application/pdf'});
  await assert.rejects(prepareProofFiles(Array(6).fill(pdf)),/more than five/);
});

test('proof preparation leaves PDFs intact and keeps mixed uploads within the request budget', async () => {
  const fullPdf = new File([Buffer.alloc(maxProofBytes)],'proof.pdf',{type:'application/pdf'});
  assert.deepEqual(await prepareProofFiles([fullPdf]),[fullPdf]);
  const image = new File([Buffer.alloc(maxImageProofBytes/2)],'proof.png',{type:'image/png'});
  const pdf = new File([Buffer.alloc(maxProofBytes-image.size)],'proof.pdf',{type:'application/pdf'});
  assert.deepEqual(await prepareProofFiles([pdf,image]),[pdf,image]);
  await assert.rejects(prepareProofFiles([fullPdf,image]),/3 MB/);
  await assert.rejects(prepareProofFiles([new File([Buffer.alloc(maxProofBytes+1)],'large.pdf')]),/3 MB/);
});
