"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Field, Input } from "@/components/app/form-parts";
import { formatCoordinates, googleMapsLink, parseCoordinates } from "@/lib/coordinates";

/**
 * Single "paste coordinates" field (fix, 2026-09-26) — replaces the old
 * separate Latitude / Longitude inputs. Paste whatever Google Maps gives you
 * ("-6.914744, 107.609810" from Copy coordinates, or the DMS format from the
 * share sheet) and it's parsed straight into lat/lng. Pair with
 * <LeafletPicker /> below it so the point can still be fine-tuned by
 * clicking/dragging on the map.
 */
export function CoordinatePasteField({
  latitude,
  longitude,
  onChange,
  disabled,
  label = "Koordinat (paste dari Google Maps)",
  id = "coord-paste",
  hint = 'Klik kanan titik di Google Maps → "Bagikan titik ini" atau "Salin koordinat", lalu tempel di sini.',
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number | null, lng: number | null) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
  hint?: string;
}) {
  const [raw, setRaw] = useState(() =>
    formatCoordinates(latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null),
  );
  const [error, setError] = useState<string | null>(null);

  // Keep the text field in sync when the value changes from elsewhere (e.g.
  // clicking/dragging the map below) — but don't clobber what the user is
  // actively typing if it still parses to the same point.
  useEffect(() => {
    const point = latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null;
    const parsedRaw = parseCoordinates(raw);
    const matches =
      point && parsedRaw && Math.abs(point.lat - parsedRaw.lat) < 1e-6 && Math.abs(point.lng - parsedRaw.lng) < 1e-6;
    if (!matches) setRaw(formatCoordinates(point));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude]);

  function handleChange(value: string) {
    setRaw(value);
    if (value.trim() === "") {
      setError(null);
      onChange(null, null);
      return;
    }
    const parsed = parseCoordinates(value);
    if (parsed) {
      setError(null);
      onChange(parsed.lat, parsed.lng);
    } else {
      setError("Format tidak dikenali - contoh: -6.914744, 107.609810");
    }
  }

  const point = latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null;

  return (
    <Field label={label} htmlFor={id} error={error ?? undefined} hint={!error ? hint : undefined} className="sm:col-span-2">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={raw}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="-6.914744, 107.609810"
          disabled={disabled}
          className="font-mono text-xs"
        />
        {point && (
          <a
            href={googleMapsLink(point)}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
            title="Buka di Google Maps"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </Field>
  );
}
