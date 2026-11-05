"use client";

import { useEffect, useRef, type ImgHTMLAttributes } from "react";
import { dataUrlToBlob } from "@/presentation/open-data-url";

/** Blob sources support the browser's native Open Image in New Tab action. */
export function OpenableImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (typeof src !== "string" || !src.startsWith("data:image/") || !image.current) return;
    let url: string;
    try {
      url = URL.createObjectURL(dataUrlToBlob(src));
    } catch {
      return;
    }
    image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [src]);
  return <img {...props} ref={image} alt={alt} src={src} />;
}
