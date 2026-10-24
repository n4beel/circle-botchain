"use client";

import React, { forwardRef } from "react";

export type OrbitButtonRole =
  | "primary"
  | "secondary"
  | "subtle"
  | "caution"
  | "pill"
  | "ghost"
  | "danger"
  | "outline";

export type OrbitButtonDimensions =
  | "compact"
  | "regular"
  | "spacious"
  | "sm"
  | "md"
  | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: OrbitButtonRole;
  size?: OrbitButtonDimensions;
  loading?: boolean;
}

/**
 * Orbit Archetype Action Button.
 * Features organic capsule geometry, chartreuse tactile presence, and high-contrast ink.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "regular",
      loading = false,
      disabled = false,
      children,
      className = "",
      style,
      ...rest
    },
    ref
  ) => {
    let backgroundColour = "var(--accent, #D9E86B)";
    let textColour = "var(--accent-ink, #1B2511)";
    let borderOutline = "none";
    let curveClass = "rounded-full";

    if (variant === "secondary") {
      backgroundColour = "var(--bg-surface, #384929)";
      textColour = "var(--text-primary, #EEF2DD)";
      borderOutline = "1px solid var(--border-default, #5A7042)";
      curveClass = "rounded-xl";
    } else if (variant === "subtle" || variant === "ghost") {
      backgroundColour = "transparent";
      textColour = "var(--text-muted, #B5C09A)";
      borderOutline = "1px solid var(--border-subtle, #4B5E36)";
      curveClass = "rounded-xl";
    } else if (variant === "caution" || variant === "danger") {
      backgroundColour = "color-mix(in srgb, var(--fail, #E57373) 15%, transparent)";
      textColour = "var(--fail, #E57373)";
      borderOutline = "1px solid color-mix(in srgb, var(--fail, #E57373) 45%, transparent)";
      curveClass = "rounded-xl";
    } else if (variant === "pill") {
      backgroundColour = "color-mix(in srgb, var(--bg-surface) 90%, var(--accent))";
      textColour = "var(--text-primary, #EEF2DD)";
      borderOutline = "1px solid var(--border-subtle, #4B5E36)";
      curveClass = "rounded-full";
    } else if (variant === "outline") {
      backgroundColour = "transparent";
      textColour = "var(--accent, #D9E86B)";
      borderOutline = "1px solid var(--accent, #D9E86B)";
      curveClass = "rounded-full";
    }

    const isSmall = size === "compact" || size === "sm";
    const isLarge = size === "spacious" || size === "lg";

    const sizeClasses = isSmall
      ? "px-3.5 py-1.5 text-xs font-medium"
      : isLarge
      ? "px-7 py-3.5 text-sm font-semibold tracking-wide"
      : "px-5 py-2.5 text-xs font-semibold tracking-wide";

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 font-sans transition-all duration-150 cursor-pointer select-none active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${curveClass} ${sizeClasses} ${className}`}
        style={{
          backgroundColor: backgroundColour,
          color: textColour,
          border: borderOutline,
          ...style,
        }}
        {...rest}
      >
        {loading && (
          <span
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
