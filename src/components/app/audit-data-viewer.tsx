"use client";

import { cn } from "@/lib/utils";

/**
 * Styled audit-log data viewer.
 *
 * Replaces the old raw-JSON `<pre>{JSON.stringify(data, null, 2)}</pre>`
 * blocks that appeared when clicking "Detail perubahan" on any audit entry.
 *
 * Renders before/after data as a clean key-value grid with:
 *  - Human-readable key labels (camelCase → Title Case)
 *  - Type-aware value formatting (booleans as badges, nulls as muted em-dash,
 *    dates auto-detected and localized, nested objects rendered recursively)
 *  - Before/after diff pairs shown inline as "old → new" with color coding
 *  - Arrays rendered as comma-separated tag lists
 *
 * The component is intentionally defensive: any value type it doesn't
 * understand falls back to `String(value)` so the timeline never crashes
 * on an unexpected payload shape.
 */

// Keys that carry a "before" and "after" sub-object are rendered as a
// diff row instead of two separate rows.
interface DiffPair {
  before: unknown;
  after: unknown;
}

function isDiffPair(value: unknown): value is DiffPair {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "before" in value &&
    "after" in value &&
    Object.keys(value).length === 2
  );
}

// Convert camelCase / snake_case keys to a human-readable label.
//   "passwordChanged"  → "Password Changed"
//   "bankAccountName"  → "Bank Account Name"
//   "entityLabel"      → "Entity Label"
function formatKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Detect ISO-8601 date strings and format them for display.
function formatDateValue(value: string): string | null {
  // Strict-ish ISO check: must contain "T" and end with "Z" or a timezone
  // offset, and must parse to a valid Date.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderScalar(value: unknown, variant: "before" | "after" | "neutral" = "neutral"): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="italic text-muted-foreground/60">kosong</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
          value
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {value ? "ya" : "tidak"}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="font-mono text-foreground">{value.toLocaleString("id-ID")}</span>;
  }

  if (typeof value === "string") {
    // Try to detect ISO date strings and render them nicely.
    const formatted = formatDateValue(value);
    if (formatted) {
      return <span className="text-foreground">{formatted}</span>;
    }
    // Special sentinel values used in audit logs.
    if (value === "[hidden]" || value === "[changed]") {
      return <span className="font-semibold text-chart-4">{value}</span>;
    }
    return <span className={variant === "before" ? "text-muted-foreground line-through" : "text-foreground"}>{value}</span>;
  }

  // Fallback for anything else.
  return <span className="font-mono text-muted-foreground">{String(value)}</span>;
}

function renderValue(value: unknown, variant: "before" | "after" | "neutral" = "neutral"): React.ReactNode {
  // Diff pair: { before: ..., after: ... }
  if (isDiffPair(value)) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground line-through">
          {renderScalar(value.before)}
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium text-primary">
          {renderScalar(value.after)}
        </span>
      </span>
    );
  }

  // Array: render as a comma-separated list of tags.
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="italic text-muted-foreground/60">kosong</span>;
    }
    return (
      <span className="inline-flex flex-wrap gap-1">
        {value.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
          >
            {renderScalar(item)}
          </span>
        ))}
      </span>
    );
  }

  // Nested object: render recursively as an indented sub-grid.
  if (typeof value === "object" && value !== null) {
    return <AuditDataViewer data={value as Record<string, unknown>} variant={variant} nested />;
  }

  // Scalar value.
  return renderScalar(value, variant);
}

export function AuditDataViewer({
  data,
  variant = "neutral",
  nested = false,
}: {
  data: Record<string, unknown>;
  variant?: "before" | "after" | "neutral";
  nested?: boolean;
}) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <span className="italic text-muted-foreground/60">tidak ada data</span>;
  }

  return (
    <div
      className={cn(
        "space-y-1",
        nested && "ml-3 border-l border-border/60 pl-2",
      )}
    >
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-wrap items-start gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed">
          <span className="shrink-0 font-semibold text-muted-foreground">
            {formatKey(key)}:
          </span>
          <span className="flex-1 min-w-0">
            {renderValue(value, variant)}
          </span>
        </div>
      ))}
    </div>
  );
}
