import { HttpError } from "@/shared/http-error";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_ENCODED_LENGTH = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;

export function vehiclePhoto(value: unknown): string | null {
  if (value == null || value === "") return null;
  const match = typeof value === "string" && value.length <= MAX_ENCODED_LENGTH + 32
    ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
    : null;
  if (!match || match[2].length % 4 !== 0 || Buffer.byteLength(match[2], "base64") > MAX_PHOTO_BYTES) {
    throw new HttpError(422, "Foto kendaraan harus JPG, PNG, atau WEBP (maksimal 4 MB).");
  }
  return value as string;
}
