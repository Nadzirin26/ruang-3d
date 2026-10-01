export const MAX_MODEL_SIZE = 250 * 1024 * 1024;
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
export const modelExtensions = ['ply', 'splat', 'ksplat', 'glb'];
export function extension(name) { return name.split('.').pop().toLowerCase(); }
export async function validateModel(file) {
  const ext = extension(file.name);
  if (!modelExtensions.includes(ext)) throw new Error('Gunakan model .ply, .splat, .ksplat, atau .glb.');
  if (!file.size || file.size > MAX_MODEL_SIZE) throw new Error('Ukuran model harus antara 1 byte dan 250 MB.');
  const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  if (ext === 'glb') {
    const header = new DataView(bytes.buffer);
    if (bytes.length < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== file.size || header.getUint32(16, true) !== 0x4e4f534a) throw new Error('File GLB tidak valid.');
  }
  if (ext === 'splat' && file.size % 32 !== 0) throw new Error('Ukuran file .splat tidak sesuai format.');
  if (ext === 'ply') {
    const header = new TextDecoder().decode(bytes).split('end_header')[0];
    if (!header.startsWith('ply') || !new TextDecoder().decode(bytes).includes('end_header')) throw new Error('Header PLY tidak valid atau terlalu panjang.');
    for (const property of ['x', 'y', 'z', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']) {
      if (!new RegExp(`property\\s+\\w+\\s+${property}(?:\\s|$)`).test(header)) throw new Error(`PLY ini bukan Gaussian Splatting yang kompatibel: properti ${property} tidak tersedia.`);
    }
  }
  return ext;
}
export async function imageData(file) {
  if (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > MAX_IMAGE_SIZE) throw new Error('Pilih JPG/PNG dengan ukuran maksimal 10 MB.');
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((file.type === 'image/png' && !png) || (file.type === 'image/jpeg' && !jpg)) throw new Error('Isi file tidak sesuai format gambar.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Gambar tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });
}
