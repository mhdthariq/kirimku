"use client";

import { useCallback, useEffect, useState } from "react";

/** Hash-based SPA router: #/dashboard, #/shipments/12, ... */
export function useHashRoute(): {
  path: string;
  segments: string[];
  navigate: (to: string) => void;
} {
  const getHash = () => {
    const raw = typeof window === "undefined" ? "" : window.location.hash;
    const path = raw.replace(/^#/, "");
    return path === "" ? "/dashboard" : path;
  };

  const [path, setPath] = useState(getHash);

  useEffect(() => {
    const onChange = () => {
      setPath(getHash());
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((to: string) => {
    const target = to.startsWith("/") ? to : `/${to}`;
    if (`#${target}` === window.location.hash) return;
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const segments = path.split("/").filter(Boolean);
  return { path, segments, navigate };
}
