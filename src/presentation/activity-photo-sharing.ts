export interface ShareableActivityPhoto { id: number; photoUrl: string }

/** Saved activity evidence is an embedded JPEG/PNG, so no fetch delays the share click. */
export function activityPhotoFiles(photos: ShareableActivityPhoto[], transportId: number): File[] {
  if (!photos.length) throw new Error("Belum ada foto untuk dibagikan.");
  return photos.map((photo) => {
    const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(photo.photoUrl);
    if (!match) throw new Error(`Foto aktivitas ${photo.id} tidak dapat dibaca. Muat ulang aktivitas dan coba lagi.`);
    const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
    return new File([bytes], `transport-${transportId}-aktivitas-${photo.id}.${match[1] === "png" ? "png" : "jpg"}`, { type: `image/${match[1]}` });
  });
}

export async function shareActivityPhotos(photos: ShareableActivityPhoto[], transportId: number): Promise<"shared" | "cancelled" | "unsupported"> {
  const files = activityPhotoFiles(photos, transportId);
  if (!navigator.share || !navigator.canShare?.({ files })) return "unsupported";
  try {
    // This call happens before the first await, retaining user activation on mobile.
    await navigator.share({ files, title: `Foto aktivitas transport ${transportId}` });
    return "shared";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    throw new Error("Foto belum dapat dibagikan. Coba bagikan lebih sedikit foto atau unduh ZIP, lalu kirim melalui WhatsApp / aplikasi lain.");
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP STORE: JPEG/PNG are already compressed. No dependency or network service. */
export async function activityPhotoZip(files: File[]): Promise<Blob> {
  if (!files.length || files.length > 65535) throw new Error("Jumlah foto untuk ZIP tidak valid.");
  const parts: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = new TextEncoder().encode(file.name);
    if (name.length > 65535 || offset + bytes.length + name.length + 30 > 0xffffffff) throw new Error("Foto terlalu besar untuk satu ZIP. Unduh dalam beberapa bagian.");
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); view.setUint16(12, 33, true);
    view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
    view.setUint16(26, name.length, true); header.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
    parts.push(header, bytes); directory.push(central);
    offset += header.length + bytes.length;
  }
  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
  if (offset + directorySize > 0xffffffff) throw new Error("Arsip terlalu besar. Unduh dalam beberapa bagian.");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}

export async function downloadActivityPhotos(photos: ShareableActivityPhoto[], transportId: number): Promise<void> {
  const files = activityPhotoFiles(photos, transportId);
  const blob = files.length === 1 ? files[0] : await activityPhotoZip(files);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = files.length === 1 ? files[0].name : `transport-${transportId}-foto-aktivitas.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Allow mobile browsers time to start the download before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
