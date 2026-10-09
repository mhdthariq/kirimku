export function openDataUrlInNewTab(dataUrl: string): boolean {
  if (typeof window === "undefined") return false;

  const popup = window.open("about:blank", "_blank");
  if (!popup) return false;

  try {
    if (!dataUrl.startsWith("data:")) {
      popup.location.href = dataUrl;
      return true;
    }

    const separator = dataUrl.indexOf(",");
    if (separator < 0) throw new Error("Invalid data URL");

    const metadata = dataUrl.slice(0, separator);
    const payload = dataUrl.slice(separator + 1);
    const mimeType = metadata.match(/^data:([^;,]+)/i)?.[1] ?? "application/octet-stream";
    const bytes = /;base64/i.test(metadata)
      ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));

    popup.location.href = objectUrl;
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  } catch {
    popup.close();
    return false;
  }
}
