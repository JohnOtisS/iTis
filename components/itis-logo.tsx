"use client";

/* Custom brand logos are local/authored assets and should bypass image optimization. */
/* eslint-disable @next/next/no-img-element */

import { useId } from "react";

type ItisLogoProps = {
  size?: number;
  className?: string;
  title?: string;
};

export function ItisLogo({ size = 40, className = "", title }: ItisLogoProps) {
  const uid = useId().replace(/:/g, "");
  const frameGradient = `${uid}-frame`;
  const signalGradient = `${uid}-signal`;
  const glow = `${uid}-glow`;

  return (
    <span
      className={`itis-logo ${className}`.trim()}
      style={{ width: size, height: size }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={frameGradient} x1="9" y1="8" x2="55" y2="56" gradientUnits="userSpaceOnUse">
            <stop stopColor="#B8FF6B" />
            <stop offset="0.48" stopColor="#63E6D4" />
            <stop offset="1" stopColor="#7AA2FF" />
          </linearGradient>
          <linearGradient id={signalGradient} x1="20" y1="18" x2="47" y2="47" gradientUnits="userSpaceOnUse">
            <stop stopColor="#E9FFD0" />
            <stop offset="0.52" stopColor="#B8FF6B" />
            <stop offset="1" stopColor="#63E6D4" />
          </linearGradient>
          <filter id={glow} x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="1.7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M32 4.75 51.25 15.9 58 38.35 44.25 56H19.75L6 38.35l6.75-22.45L32 4.75Z"
          fill="#08100F"
          stroke={`url(#${frameGradient})`}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path
          d="M14.1 20.2 20.4 16.5M49.9 20.2 43.6 16.5M12.35 38.1l4.9 6.3M51.65 38.1l-4.9 6.3"
          stroke="#63E6D4"
          strokeWidth="1.35"
          strokeLinecap="round"
          opacity=".58"
        />

        <g filter={`url(#${glow})`} stroke={`url(#${signalGradient})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 29.5V44" />
          <path d="M34 23h15" />
          <path d="M41.5 23v21" />
        </g>
        <circle cx="22" cy="20.5" r="3" fill="#B8FF6B" />
        <circle cx="22" cy="44" r="2.25" fill="#63E6D4" />
        <circle cx="41.5" cy="44" r="2.25" fill="#7AA2FF" />
        <circle cx="49" cy="23" r="2.1" fill="#B8FF6B" />
        <path d="M28.5 14.1h7" stroke="#B8FF6B" strokeWidth="1.4" strokeLinecap="round" opacity=".72" />
        <path d="M28.5 49.9h7" stroke="#63E6D4" strokeWidth="1.4" strokeLinecap="round" opacity=".5" />
      </svg>
    </span>
  );
}

export function BrandLogo({
  src,
  size = 40,
  className = "",
  title,
}: ItisLogoProps & { src?: string | null }) {
  if (!src) return <ItisLogo size={size} className={className} title={title} />;
  return (
    <span
      className={`itis-logo ${className}`.trim()}
      style={{ width: size, height: size }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <img src={src} alt="" className="size-full object-contain" />
    </span>
  );
}
