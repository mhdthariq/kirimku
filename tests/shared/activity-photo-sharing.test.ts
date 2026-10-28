import { afterEach, describe, expect, it, vi } from "vitest";
import { activityPhotoFiles, activityPhotoZip, shareActivityPhotos } from "@/presentation/activity-photo-sharing";

const photos = [
  { id: 2, photoUrl: "data:image/jpeg;base64,MTIzNDU2Nzg5" },
  { id: 3, photoUrl: "data:image/png;base64,YWJj" },
];
afterEach(() => vi.unstubAllGlobals());

describe("activity image sharing", () => {
  it("shares every image as a file immediately in the click call stack", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { share, canShare });
    const result = shareActivityPhotos(photos, 10);
    expect(share).toHaveBeenCalledOnce();
    const { files } = share.mock.calls[0][0];
    expect(files.map((file: File) => [file.name, file.type])).toEqual([
      ["transport-10-aktivitas-2.jpg", "image/jpeg"], ["transport-10-aktivitas-3.png", "image/png"],
    ]);
    expect(await files[0].text()).toBe("123456789");
    expect(await files[1].text()).toBe("abc");
    expect(await result).toBe("shared");
  });
  it("supports sharing only one selected photo", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, canShare: () => true });
    await shareActivityPhotos([photos[1]], 10);
    expect(share.mock.calls[0][0].files).toHaveLength(1);
  });
  it.each([{}, { share: vi.fn(), canShare: () => false }])("reports unsupported file sharing without sending links", async (navigator) => {
    vi.stubGlobal("navigator", navigator);
    expect(await shareActivityPhotos(photos, 10)).toBe("unsupported");
  });
  it("treats cancellation quietly and reports other share failures", async () => {
    const share = vi.fn().mockRejectedValueOnce(new DOMException("cancel", "AbortError")).mockRejectedValueOnce(new Error("blocked"));
    vi.stubGlobal("navigator", { share, canShare: () => true });
    expect(await shareActivityPhotos(photos, 10)).toBe("cancelled");
    await expect(shareActivityPhotos(photos, 10)).rejects.toThrow("unduh ZIP");
  });
  it("rejects empty or malformed photos instead of silently omitting them", () => {
    expect(() => activityPhotoFiles([], 10)).toThrow("Belum ada foto");
    expect(() => activityPhotoFiles([...photos, { id: 5, photoUrl: "https://external.test/image.jpg" }], 10)).toThrow("5");
  });
  it("creates a ZIP with every original byte, valid CRC and directory offsets", async () => {
    const archive = await activityPhotoZip(activityPhotoFiles(photos, 10));
    expect(archive.type).toBe("application/zip");
    const buffer = await archive.arrayBuffer();
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0xcbf43926); // Independent standard CRC32 check vector.
    const end = buffer.byteLength - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    let directoryOffset = view.getUint32(end + 16, true);
    for (const expected of ["123456789", "abc"]) {
      expect(view.getUint32(directoryOffset, true)).toBe(0x02014b50);
      const offset = view.getUint32(directoryOffset + 42, true);
      const nameLength = view.getUint16(offset + 26, true);
      const size = view.getUint32(offset + 18, true);
      expect(new TextDecoder().decode(buffer.slice(offset + 30 + nameLength, offset + 30 + nameLength + size))).toBe(expected);
      directoryOffset += 46 + view.getUint16(directoryOffset + 28, true);
    }
    expect(directoryOffset).toBe(end);
  });
});
