import React from "react";

export type OrbitSurfaceVariant = "plate" | "capsule" | "halo" | "well" | "ringCard";

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: OrbitSurfaceVariant;
  padded?: boolean;
  accentBorder?: boolean;
}

/**
 * Orbit Archetype Surface Enclosure.
 * Renders atmospheric olive plates with chartreuse cues and organic planetary radiuses.
 */
export default function Panel({
  variant = "plate",
  padded = true,
  accentBorder = false,
  children,
  className = "",
  style,
  ...rest
}: PanelProps) {
  let surfaceBackground = "var(--bg-surface, #384929)";
  let borderStyling = accentBorder
    ? "1px solid var(--accent, #D9E86B)"
    : "1px solid var(--border-subtle, #4B5E36)";
  let radiusClass = "rounded-2xl";

  if (variant === "capsule") {
    surfaceBackground = "var(--bg-elevated, #425631)";
    radiusClass = "rounded-full";
  } else if (variant === "halo") {
    surfaceBackground = "color-mix(in srgb, var(--accent) 10%, #384929)";
    borderStyling = "1px solid color-mix(in srgb, var(--accent) 40%, transparent)";
    radiusClass = "rounded-2xl";
  } else if (variant === "well") {
    surfaceBackground = "var(--bg-overlay, #27331A)";
    borderStyling = "1px solid var(--border-subtle, #4B5E36)";
    radiusClass = "rounded-xl";
  } else if (variant === "ringCard") {
    surfaceBackground = "var(--bg-surface, #384929)";
    radiusClass = "rounded-3xl shadow-sm hover:border-[var(--accent)]";
  }

  const paddingClass = padded ? "p-5 sm:p-7" : "";

  return (
    <div
      className={`relative overflow-hidden transition-all duration-200 ${radiusClass} ${paddingClass} ${className}`}
      style={{
        backgroundColor: surfaceBackground,
        border: borderStyling,
        color: "var(--text-primary, #EEF2DD)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
