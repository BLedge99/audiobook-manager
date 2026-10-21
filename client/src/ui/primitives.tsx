import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type CSSProperties } from "react";
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Sun, Moon } from "lucide-react";
import { CoverImage, bookCoverKey } from "../local/CoverImage";
import { copy } from "../copy";
import { useLightEffects, useTheme } from "./theme";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ marks */

/**
 * Status colours. Every use is paired with a text label somewhere visible, so
 * colour is never the only carrier of meaning -- see the legend row under the
 * library heading.
 *
 * The labels come from `copy.ts`, because they are user-facing strings like
 * any other and the whole point of feature 7 is that there is one place to
 * change them.
 */
export const STATUS = {
  done: { label: copy.status.done, color: "var(--mint)" },
  reading: { label: copy.status.reading, color: "var(--tan)" },
  fresh: { label: copy.status.fresh, color: "var(--cobalt)" },
  changed: { label: copy.status.changed, color: "var(--rasp)" },
} as const;

export type StatusKey = keyof typeof STATUS;

export function statusFor(percent: number): StatusKey {
  if (percent >= 100) return "done";
  if (percent > 0) return "reading";
  return "fresh";
}

export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn("swatch", className)} style={{ background: color }} />;
}

/** Colour plus its name. The name is the point; the colour is the reminder. */
export function StatusTag({ status, className }: { status: StatusKey; className?: string }) {
  const entry = STATUS[status];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-bold", className)}
      style={{ color: entry.color }}
    >
      <Swatch color={entry.color} />
      {entry.label}
    </span>
  );
}

export function durationLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/* --------------------------------------------------------------- surfaces */

export function Panel({
  as: Tag = "div",
  className,
  sunk,
  flat,
  ...rest
}: {
  as?: "div" | "section" | "article" | "li" | "form";
  className?: string;
  sunk?: boolean;
  flat?: boolean;
} & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn("panel", sunk && "panel--sunk", flat && "panel--flat", className)} {...rest} />;
}

/* --------------------------------------------------------------- controls */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "plain" | "primary" | "mint" | "quiet";
  size?: "md" | "sm";
};

export function Btn({ variant = "plain", size = "md", className, type = "button", ...rest }: BtnProps) {
  return (
    <button
      type={type}
      className={cn(
        "btn",
        variant === "primary" && "btn--primary",
        variant === "mint" && "btn--mint",
        variant === "quiet" && "btn--quiet",
        size === "sm" && "btn--sm",
        className,
      )}
      {...rest}
    />
  );
}

export function IconBtn({
  label,
  className,
  children,
  ...rest
}: { label: string; className?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} className={cn("iconbtn", className)} {...rest}>
      {children}
    </button>
  );
}

export function Field({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("field", className)} {...rest} />;
}

export function Chip({
  on,
  className,
  children,
  ...rest
}: { on?: boolean; className?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-pressed={on} data-on={on ? "true" : undefined} className={cn("chip", className)} {...rest}>
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- signature */

/**
 * The play dome: the machine's one glossy control, and the only place in the
 * app allowed to be spherical and radial. Pressing it throws a particle burst.
 *
 * The 3D press offset is real depth, not a decoration: the button travels 4px
 * into its own shadow. Do not flatten it.
 */
export function Dome({
  label,
  onClick,
  className,
  spin = false,
  disabled = false,
  children,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  spin?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const effects = useLightEffects();
  const sparks = Array.from({ length: 8 }, (_, i) => {
    const angle = (-165 + i * 33) * (Math.PI / 180);
    const reach = 30 + (i % 3) * 7;
    return {
      dx: `${Math.cos(angle) * reach}px`,
      dy: `${Math.sin(angle) * reach - 6}px`,
      dr: `${(i % 2 ? 1 : -1) * (120 + i * 20)}deg`,
      i,
    };
  });

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn("dome", spin && "animate-[spin_1.1s_linear_infinite]", disabled && "cursor-not-allowed opacity-40", className)}
    >
      <span className="dome__play" aria-hidden="true" style={children ? { display: "none" } : undefined} />
      {children}
      {effects &&
        sparks.map((spark) => (
          <span
            key={spark.i}
            aria-hidden="true"
            className="spark"
            style={
              {
                "--dx": spark.dx,
                "--dy": spark.dy,
                "--dr": spark.dr,
                "--i": spark.i,
              } as CSSProperties
            }
          />
        ))}
    </button>
  );
}

/** Progress tube. Decorative: the numbers beside it carry the information. */
export function Tube({ percent, className }: { percent: number; className?: string }) {
  const status = statusFor(percent);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "tube block",
        status === "done" && "tube--done",
        status === "fresh" && "tube--new",
        className,
      )}
    >
      <i className="fill-in" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </span>
  );
}

/** Shell tints, picked deterministically so a given book always looks the same. */
const SHELL_TINTS = ["var(--cobalt)", "var(--mint)", "var(--tan)", "var(--rasp)", "#7c5cff", "#2aa3c9"];

export function shellTint(seed: number) {
  const picked = SHELL_TINTS[Math.abs(Math.round(seed * 2654435761)) % SHELL_TINTS.length];
  return { "--tint-hue": picked } as CSSProperties;
}

/**
 * A cover read through tinted acrylic.
 *
 * The art is never simply scaled: the tint sits over it and the plastic gloss
 * sits over the tint, so the cover reads as being *inside* the shell. `alt` is
 * left empty on purpose -- the title is always set as text next to it, so a
 * screen reader hears the title once rather than twice.
 *
 * The bytes come from the device cover cache (spec 15b feature 1) rather than
 * from a live `<img src>`. Every surface in the app now resolves covers the same
 * way, so a cover that has been seen stays seen, and a fetch that fails shows
 * the placeholder instead of a half-painted image.
 */
export function ShellCover({
  bookId,
  className,
  ratio = "2 / 3",
}: {
  bookId: number;
  className?: string;
  ratio?: string;
}) {
  return (
    <span className={cn("shell-art block", className)} style={{ aspectRatio: ratio, ...shellTint(bookId) }}>
      {/*
        No `display: contents` here. `CoverImage` observes its own wrapper with
        an IntersectionObserver to decide when to start fetching, and an element
        with `display: contents` has no box at all -- so it never intersects and
        no cover is ever fetched. The shell's own CSS fills this wrapper.
      */}
      <CoverImage cacheKey={bookCoverKey(bookId)} />
      <span className="shell-art__tint" aria-hidden="true" />
      <span className="capsule__gloss" aria-hidden="true" />
    </span>
  );
}

/** Screw dimples and crown seam: the two marks that make the shell moulded. */
export function CapsuleMarks() {
  return (
    <>
      <span className="capsule__seam" aria-hidden="true" />
      <span className="capsule__screw" style={{ left: 7, top: 7 }} aria-hidden="true" />
      <span className="capsule__screw" style={{ right: 7, bottom: 7 }} aria-hidden="true" />
    </>
  );
}

/* ----------------------------------------------------------------- chrome */

/**
 * The machine's mark: a canted capsule with a play dome. Drawn inline so it
 * inherits the theme tokens rather than shipping a second copy of the same
 * drawing, and so it recolours with the palette in both themes.
 */
export function MachineMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-11 shrink-0 -rotate-6 place-items-center rounded-[15px_12px_15px_12px/12px_15px_12px_15px] border-2 border-ink bg-surface",
        "shadow-[0_3px_0_-1px_color-mix(in_srgb,var(--ink)_80%,transparent)]",
        className,
      )}
    >
      <span className="grid size-7 place-items-center rounded-full border-2 border-ink bg-rasp">
        <span className="h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
      </span>
    </span>
  );
}

/** Mark plus wordmark, the masthead for every full-screen state. */
export function Wordmark({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <MachineMark />
      <div className="min-w-0">
        <p className="wordmark truncate">{title}</p>
        {subtitle ? <p className="mt-0.5 truncate text-[12px] font-semibold text-ink3">{subtitle}</p> : null}
      </div>
    </div>
  );
}

/**
 * Full-screen centred state, shared by every gate.
 *
 * Deliberately a single column that never exceeds the phone width, so the same
 * markup reads correctly in a 390px WebView and on a 1440px desktop.
 */
export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center bg-ground px-5 py-10">
      <Specks />
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}

/**
 * Ambient field. Eight drifting specks so the page reads as a lit machine
 * rather than a flat sheet. Skipped entirely on reduced-motion and low-core
 * devices, and never above the content: it is `pointer-events: none` at z-0.
 */
export function Specks() {
  const effects = useLightEffects();
  if (!effects) return null;
  const specks = [
    { left: "8%", top: "18%", size: 6, delay: "0s" },
    { left: "76%", top: "12%", size: 4, delay: "-3s" },
    { left: "88%", top: "46%", size: 7, delay: "-7s" },
    { left: "18%", top: "62%", size: 5, delay: "-11s" },
    { left: "62%", top: "78%", size: 4, delay: "-5s" },
    { left: "40%", top: "34%", size: 3, delay: "-14s" },
    { left: "4%", top: "84%", size: 5, delay: "-9s" },
    { left: "70%", top: "58%", size: 3, delay: "-16s" },
  ];
  return (
    <div className="specks" aria-hidden="true">
      {specks.map((speck, index) => (
        <span
          key={index}
          className="speck"
          style={{
            left: speck.left,
            top: speck.top,
            width: speck.size,
            height: speck.size,
            animationDelay: speck.delay,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Light and dark. **Two states, not three.**
 *
 * The toggle used to cycle through light -> dark -> "follow the device" ->
 * light, and show the *preference* rather than what you are looking at. So a
 * fresh install -- which follows the device -- showed a monitor icon, and
 * clicking it appeared to do nothing whenever the device happened to be in the
 * theme it had already chosen. The household noticed, and was right to.
 *
 * Now the icon is the theme you are **in**, and one tap goes to the other
 * one. "Follow the device" is not a stop on the cycle: it is the *default*,
 * kept until someone touches the toggle, and the first tap then goes to the
 * opposite of what the device is showing.
 */
export function ThemeToggle() {
  const { resolved, setChoice } = useTheme();
  const isDark = resolved === "dark";
  const Icon = isDark ? Moon : Sun;
  return (
    <IconBtn
      // The label names the *action*, not the state: in light mode the button
      // says it will switch to dark.
      label={isDark ? copy.theme.light : copy.theme.dark}
      onClick={() => setChoice(isDark ? "light" : "dark")}
    >
      <Icon size={19} aria-hidden="true" />
    </IconBtn>
  );
}

/* --------------------------------------------------------------- headings */

/**
 * Section heading.
 *
 * No kicker or eyebrow above it -- the heading carries its own weight. The
 * machine's part name is optional and only used where it names a part rather
 * than describing the content.
 */
export function MachineHead({
  title,
  count,
  children,
  id,
}: {
  title: string;
  count?: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div className="machine-head">
      <h2 id={id}>{title}</h2>
      {children}
      {count ? <span className="shrink-0 text-[13px] font-bold text-ink3 tnum">{count}</span> : null}
    </div>
  );
}

/** The legend that stops status colour from having to speak for itself. */
export function StatusLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-2", className)}>
      {(["done", "reading", "fresh"] as const).map((status) => (
        <li key={status}>
          <StatusTag status={status} />
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel panel--sunk px-6 py-14 text-center">
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm text-ink2">{children}</div> : null}
    </div>
  );
}

/** Transient message. `alert` interrupts; `status` does not. */
export function Notice({
  tone = "info",
  role = "status",
  icon,
  children,
  className,
}: {
  tone?: "info" | "warn" | "error";
  role?: "status" | "alert";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const accent = tone === "error" ? "var(--rasp)" : tone === "warn" ? "var(--tan)" : "var(--cobalt)";
  return (
    <div
      role={role}
      className={cn("panel panel--flat flex items-start gap-3 px-4 py-3 text-sm", className)}
      style={{ background: `color-mix(in srgb, ${accent} 12%, var(--surface))` }}
    >
      {icon ? <span style={{ color: accent }} className="shrink-0">{icon}</span> : null}
      <div className="min-w-0 text-ink2">{children}</div>
    </div>
  );
}