import { describe, expect, it } from "vitest";
import { vehiclePhoto } from "@/shared/vehicle-photo";
describe("vehicle photo validation", () => {
  it.each([null, undefined, ""])("allows clearing an optional photo with %s", value => expect(vehiclePhoto(value)).toBeNull());
  it.each(["jpeg", "png", "webp"])("accepts %s photos", type => {
    const photo = `data:image/${type};base64,AAAA`;
    expect(vehiclePhoto(photo)).toBe(photo);
  });
  it.each([123, {}, "https://example.com/image.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,", "data:image/png;base64,A==="])("rejects unsupported or malformed input %j", value => {
    expect(() => vehiclePhoto(value)).toThrow("Foto kendaraan");
  });
  it("accepts exactly 4 MB and rejects a photo one byte larger", () => {
    expect(vehiclePhoto("data:image/png;base64," + Buffer.alloc(4 * 1024 * 1024).toString("base64"))).toBeTruthy();
    expect(() => vehiclePhoto("data:image/png;base64," + Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64"))).toThrow("maksimal 4 MB");
  });
});
