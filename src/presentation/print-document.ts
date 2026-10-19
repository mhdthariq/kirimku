/** Wait for the same fonts and proof/QR images visible in the preview. */
export async function printPaperDocument() {
  await document.fonts?.ready;
  await Promise.all(Array.from(document.querySelectorAll<HTMLIFrameElement>("[data-paper-source]")).map(async frame => {
    const source = frame.contentDocument;
    if (!source) return;
    await Promise.all(Array.from(source.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(link => link.sheet ? Promise.resolve() : new Promise<void>(resolve => {
      link.addEventListener("load", () => resolve(), { once: true });
      link.addEventListener("error", () => resolve(), { once: true });
    })));
    await source.fonts?.ready;
  }));
  await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>("[data-print-portal] img")).map(image => image.decode?.().catch(() => undefined)));
  window.dispatchEvent(new Event("beforeprint"));
  if (typeof window.requestAnimationFrame === "function") await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  window.print();
}
