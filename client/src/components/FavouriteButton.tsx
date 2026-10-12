import { Heart } from "lucide-react";

/**
 * Spec 18 — the favourite toggle.
 *
 * Rendered as a real button rather than an icon inside the card button, so it
 * is reachable by keyboard and does not nest interactive elements.
 */
export function FavouriteButton({
  favourited,
  onToggle,
  label,
  size = "sm",
}: {
  favourited: boolean;
  onToggle: () => void;
  label: string;
  size?: "sm" | "lg";
}) {
  const dimensions = size === "lg" ? "size-11" : "size-9";
  const iconSize = size === "lg" ? 22 : 18;

  return (
    <button
      type="button"
      onClick={(event) => {
        // The card itself is a button; do not let this click open the detail.
        event.stopPropagation();
        onToggle();
      }}
      aria-pressed={favourited}
      aria-label={favourited ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
      title={favourited ? "In your favourites" : "Add to favourites"}
      className={`grid ${dimensions} shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-950/85 backdrop-blur transition hover:border-rose-400 ${
        favourited ? "text-rose-400" : "text-slate-400 hover:text-rose-300"
      }`}
    >
      <Heart size={iconSize} fill={favourited ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  );
}