import { useState } from "react";
import { api } from "../api/client";

interface Props {
  venue?: string | null;
  location?: string | null;
  /** Static map render width passed to the backend proxy. */
  width?: number;
  /** Static map render height passed to the backend proxy. */
  height?: number;
}

/**
 * Static Google Map of the event venue + a "Open in Google Maps" link.
 *
 * The map image is served from our backend proxy so the Google API key
 * stays server-side. If the backend returns a non-200 (e.g. 503 when
 * the key isn't configured), the card hides itself rather than
 * showing a broken-image icon — no half-rendered states.
 */
export default function EventMapCard({ venue, location, width = 600, height = 300 }: Props) {
  const [errored, setErrored] = useState(false);

  // Build a single query that biases the map toward whatever the
  // organizer entered. Venue first (specific landmarks), location
  // second (city/address) — both improve the lat/lng resolution.
  const parts = [venue, location]
    .filter((s): s is string => typeof s === "string")
    .map(s => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const query = parts.join(", ");
  const mapImgUrl = api.placesStaticMapUrl(query, width, height);
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  if (errored) return null;

  return (
    <div className="event-map-card">
      <a
        href={googleMapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="event-map-img-link"
        title="Open in Google Maps"
      >
        <img
          src={mapImgUrl}
          alt={`Map of ${query}`}
          className="event-map-img"
          loading="lazy"
          onError={() => setErrored(true)}
        />
      </a>
      <div className="event-map-meta">
        {/* Venue + address on one line, mirroring the event meta line above:
            "Venue Name · Address". Falls back to just venue or just address
            when only one is set. */}
        <div className="event-map-where">
          {venue}
          {venue && location && " · "}
          {location}
        </div>
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="event-map-open-link"
        >
          Open in Google Maps
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </div>
  );
}
