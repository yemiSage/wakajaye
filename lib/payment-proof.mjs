export const maxProofFiles = 5;
export const maxProofBytes = 3 * 1024 ** 2;
export const maxImageInputBytes = 10 * 1024 ** 2;
export const maxImageProofBytes = 1024 ** 2;

export function proofFiles(rent, name, mime, size) {
  return rent?.proofs ?? [{ name, mime, size }];
}

export function proofAt(bytes, files, index) {
  const file = files[index];
  if (!file) return null;
  const offset = files.slice(0, index).reduce((sum, entry) => sum + entry.size, 0);
  return { ...file, bytes: bytes.subarray(offset, offset + file.size) };
}

export function paymentStatus(status, rent) {
  if (status === 'pending') return rent?.review?.status ?? status;
  return status;
}
