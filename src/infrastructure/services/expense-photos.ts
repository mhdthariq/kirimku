import { MAX_EXPENSE_PHOTOS, expensePhotoUrls } from "@/domain/expense-photos";
import { parseOptionalPhoto } from "@/infrastructure/services/transport-ops-server";

export function parseExpensePhotos(body: { photos?: unknown; photo?: unknown; removePhoto?: unknown }, existing?: { photoUrl?: string | null; photoUrls?: string[] }) {
  if (body.photos === undefined) return { photos: undefined };
  if (!Array.isArray(body.photos) || body.photos.length > MAX_EXPENSE_PHOTOS) return { error: `Maksimal ${MAX_EXPENSE_PHOTOS} foto bukti per biaya.` };
  const additions: string[] = [];
  for (const item of body.photos) {
    const parsed = parseOptionalPhoto(item);
    if (parsed.error || !parsed.photoUrl) return { error: parsed.error ?? "Foto bukti tidak valid." };
    additions.push(parsed.photoUrl);
  }
  const photos = [...new Set([...(body.removePhoto === true ? [] : expensePhotoUrls(existing ?? {})), ...additions])];
  if (photos.length > MAX_EXPENSE_PHOTOS) return { error: `Maksimal ${MAX_EXPENSE_PHOTOS} foto bukti per biaya.` };
  if (photos.reduce((total, photo) => total + photo.length, 0) > 10 * 1024 * 1024) return { error: "Total ukuran foto bukti maksimal 10 MB." };
  return { photos };
}
