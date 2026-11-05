import { maxImageInputBytes, maxImageProofBytes, maxProofBytes, maxProofFiles } from './payment-proof.mjs';

const isImage = file => file.type?.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif|tiff?|svg)$/i.test(file.name);
const totalSizeError = 'Keep PDFs and saved proof files below 3 MB in total to leave room for images.';

export async function compressProofImage(file, maxBytes = maxImageProofBytes) {
  if (!file.size || file.size > maxImageInputBytes) throw Error('Choose images up to 10 MB each.');
  if (file.size <= maxBytes && /\.(png|jpe?g)$/i.test(file.name)) return file;

  const url = URL.createObjectURL(file);
  const canvas = document.createElement('canvas');
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context || !image.naturalWidth || !image.naturalHeight) throw Error('Image unavailable.');
    for (;;) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.9, 0.75, 0.6, 0.45]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) throw Error('Image unavailable.');
        if (blob.size <= maxBytes) {
          const name = file.name.replace(/\.[^.]+$/, '').slice(0, 230) + '.jpg';
          return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
        }
      }
      if (width === 1 && height === 1) throw Error('Image cannot fit.');
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
  } catch {
    throw Error('Could not compress “' + file.name + '”. Try saving it as a JPG or PNG and adding it again.');
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 1;
  }
}

export async function prepareProofFiles(files) {
  if (files.length > maxProofFiles) throw Error('Remove a file before adding more than five.');
  const images = [];
  let fixedBytes = 0;
  for (const file of files) {
    if (file.keep !== undefined) {
      fixedBytes += file.size;
    } else if (isImage(file)) {
      if (!file.size || file.size > maxImageInputBytes) throw Error('Choose images up to 10 MB each.');
      images.push(file);
    } else if (/\.pdf$/i.test(file.name) && file.size) {
      fixedBytes += file.size;
    } else {
      throw Error('Choose a PDF or image file.');
    }
  }
  const available = maxProofBytes - fixedBytes;
  if (available < images.length * 1024) throw Error(totalSizeError);
  const target = Math.min(maxImageProofBytes, Math.floor(available / (images.length || 1)));
  const prepared = [];
  // Process one image at a time to limit memory use on phones.
  for (const file of files) {
    prepared.push(images.includes(file) ? await compressProofImage(file, target) : file);
  }
  return prepared;
}
