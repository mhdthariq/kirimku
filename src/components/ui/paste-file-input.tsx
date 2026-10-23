"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";

/** Paste uses the same change handler and validation as the file picker. */
export function PasteFileInput({ native = false, ...props }: React.ComponentProps<"input"> & { native?: boolean }) {
  const [error, setError] = React.useState("");
  function focusPasteArea(event: React.MouseEvent<HTMLSpanElement>) {
    if (event.target instanceof HTMLInputElement) return;
    // Labels surrounding hidden pickers otherwise open the file dialog here.
    event.preventDefault();
    event.currentTarget.focus();
  }
  function onPaste(event: React.ClipboardEvent<HTMLSpanElement>) {
    if (props.disabled) return;
    const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
    if (!images.length) return;
    event.preventDefault();
    const accepted = images.filter(file => !props.accept || props.accept.split(",").some(value => {
      const rule = value.trim();
      return rule === file.type || (rule.endsWith("/*") && file.type.startsWith(rule.slice(0, -1)));
    }));
    if (!accepted.length) { setError("Format foto tidak didukung oleh kolom ini."); return; }
    const input = event.currentTarget.querySelector("input");
    if (!input) return;
    const transfer = new DataTransfer();
    (props.multiple ? accepted : accepted.slice(0, 1)).forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    setError("");
  }
  const Control = native ? "input" : Input;
  return <span className="inline-flex w-full min-w-0 flex-col gap-1 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" tabIndex={props.disabled ? -1 : 0} role="group" aria-label="Upload atau tempel foto" onClick={focusPasteArea} onPaste={onPaste}>
    <Control {...props} />
    <span className="text-xs font-normal text-muted-foreground">Klik di sini lalu Ctrl+V untuk tempel foto.</span>
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
  </span>;
}
