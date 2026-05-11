import { useNavigate } from "react-router-dom";
import type { Attendee } from "../types";

interface Props {
  attendee: Attendee;
  onEdit?: (attendee: Attendee) => void;
  onDelete?: (id: number) => void;
  seated?: boolean;
}

const COUNTRY_FLAGS: Record<string, string> = {
  "France": "🇫🇷", "United Kingdom": "🇬🇧", "United States": "🇺🇸",
  "USA": "🇺🇸", "UK": "🇬🇧", "Germany": "🇩🇪", "Netherlands": "🇳🇱",
  "Belgium": "🇧🇪", "Spain": "🇪🇸", "Italy": "🇮🇹", "Brazil": "🇧🇷",
  "Canada": "🇨🇦", "Australia": "🇦🇺", "India": "🇮🇳", "Colombia": "🇨🇴",
  "Romania": "🇷🇴", "Switzerland": "🇨🇭", "Poland": "🇵🇱", "Sweden": "🇸🇪",
  "Ireland": "🇮🇪", "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "South Africa": "🇿🇦",
  "Zimbabwe": "🇿🇼", "Egypt": "🇪🇬", "Morocco": "🇲🇦", "Albania": "🇦🇱",
  "Japan": "🇯🇵", "Mexico": "🇲🇽", "Argentina": "🇦🇷", "New Zealand": "🇳🇿",
};

export type DietBadge = { icon: string; label: string; color: string; bg: string };

export function getDietaryBadges(dietary: string | null): DietBadge[] {
  if (!dietary || dietary === "—") return [];
  const lower = dietary.toLowerCase();
  const badges: DietBadge[] = [];

  if (lower.includes("végan") || lower.includes("vegan")) {
    badges.push({ icon: "🌱", label: "Vegan", color: "#15803d", bg: "#dcfce7" });
  } else if (lower.includes("végétarien") || lower.includes("vegetarian")) {
    badges.push({ icon: "🌿", label: "Vegetarian", color: "#166534", bg: "#f0fdf4" });
  }
  if (lower.includes("sans gluten") || lower.includes("gluten-free") || lower.includes("gluten free")) {
    badges.push({ icon: "🌾", label: "Gluten-free", color: "#92400e", bg: "#fef3c7" });
  }
  if (lower.includes("sans alcool") || lower.includes("no alcohol")) {
    badges.push({ icon: "🚫", label: "No alcohol", color: "#6b7280", bg: "#f3f4f6" });
  }
  if (lower.includes("porc") || lower.includes("pork")) {
    badges.push({ icon: "🐷", label: "No pork", color: "#b45309", bg: "#fef3c7" });
  }
  if (badges.length === 0) {
    badges.push({ icon: "⚠️", label: "Dietary Restriction", color: "#b45309", bg: "#fffbeb" });
  }
  return badges;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  confirmed: { color: "#15803d", bg: "#dcfce7", label: "Confirmed" },
  pending:   { color: "#b45309", bg: "#fef3c7", label: "Pending" },
  declined:  { color: "#b91c1c", bg: "#fee2e2", label: "Declined" },
};

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function avatarColor(dietary: string | null) {
  if (!dietary) return "#1b4fff";
  const d = dietary.toLowerCase();
  if (d.includes("végan") || d.includes("vegan") || d.includes("végétarien") || d.includes("vegetarian")) return "#16a34a";
  if (d.length > 0) return "#d97706";
  return "#1b4fff";
}

export default function AttendeeCard({ attendee, onEdit, onDelete }: Props) {
  const navigate = useNavigate();
  const status = STATUS_CONFIG[attendee.rsvp_status] || STATUS_CONFIG.pending;
  const dietBadges = getDietaryBadges(attendee.dietary_requirements);
  const flag = attendee.country ? (COUNTRY_FLAGS[attendee.country] ?? "🌍") : null;
  const color = avatarColor(attendee.dietary_requirements);

  return (
    <div
      className="ac-card"
      onClick={() => navigate(`/events/${attendee.event_id}/attendees/${attendee.id}`)}
    >
      {/* Avatar — upper left */}
      <div className="ac-card-avatar" style={{ background: color }}>
        {getInitials(attendee.name)}
      </div>

      {/* Dietary badge — upper right */}
      {dietBadges.length > 0 && (
        <div className="ac-corner-diet">
          {dietBadges.map((b, i) => (
            <span key={i} className="ac-corner-diet-badge" style={{ background: b.bg, color: b.color }}>
              {b.icon} {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Centred content */}
      <div className="ac-card-name">{attendee.name}</div>
      {attendee.rsvp_status !== "confirmed" && (
        <div className="ac-card-status" style={{ color: status.color, background: status.bg }}>
          {status.label}
        </div>
      )}
      {flag && attendee.country && (
        <div className="ac-card-country">{flag} {attendee.country}</div>
      )}

      {(onEdit || onDelete) && (
        <div className="ac-card-actions" onClick={e => e.stopPropagation()}>
          {onEdit && (
            <button className="ac-card-btn" onClick={() => onEdit(attendee)}>Edit</button>
          )}
          {onDelete && (
            <button className="ac-card-btn ac-card-btn-danger" onClick={() => onDelete(attendee.id)}>
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
