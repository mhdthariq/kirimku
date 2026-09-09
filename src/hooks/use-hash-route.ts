"use client";

import { useCallback, useEffect, useState } from "react";

/** Hash-based SPA router: #/dashboard, #/shipments/12, #/shipments/12?print=1 */
export function useHashRoute(): {
  path: string;
  segments: string[];
  query: URLSearchParams;
  navigate: (to: string) => void;
} {
  const parse = () => {
    const raw = typeof window === "undefined" ? "" : window.location.hash;
    const clean = raw.replace(/^#/, "");
    const [pathPart, queryPart] = clean.split("?");
    const path = pathPart === "" || pathPart === "/" ? "/dashboard" : pathPart;
    const query = new URLSearchParams(queryPart ?? "");
    return { path, query };
  };

  const [state, setState] = useState(parse);

  useEffect(() => {
    const onChange = () => setState(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((to: string) => {
    const target = to.startsWith("/") ? to : `/${to}`;
    if (`#${target}` === window.location.hash) return;
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const segments = state.path.split("/").filter(Boolean);
  return { path: state.path, segments, query: state.query, navigate };
}
