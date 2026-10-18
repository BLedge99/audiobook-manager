import { Heart } from "lucide-react";
import { cn } from "../ui/primitives";

/**
 * Spec 18 -- the favourite toggle.
 *
 * Rendered as a real button rather than an icon inside the card button, so it
 * is reachable by keyboard and does not nest interactive elements.
 *
 * The accessible names here ("Add <title> to favourites" / "Remove ... from
 * favourites") are relied on by the E2E suite and must not be shortened: on a
 * grid of forty covers, "Add to favourites" alone does not say which one.
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
      className={cn(
        "grid shrink-0 place-items-center rounded-full border-2 border-ink bg-surface/90 backdrop-blur-sm transition",
        "hover:-translate-y-0.5 hover:bg-rasp hover:text-white",
        dimensions,
        favourited ? "bg-rasp text-white" : "text-ink2",
      )}
    >
      <Heart
        size={iconSize}
        fill={favourited ? "currentColor" : "none"}
        strokeWidth={2.2}
        aria-hidden="true"
      />
    </button>
  );
}