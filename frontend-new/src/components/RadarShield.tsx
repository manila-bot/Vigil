/** Animated radar: rotating sweep, orbiting satellites, law shield in the center. Turns red under attack. */
export function RadarShield({ underAttack }: { underAttack: boolean }) {
  const c = underAttack ? "var(--destructive)" : "var(--primary)";
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <svg
        viewBox="0 0 400 400"
        className="h-[92%] max-h-[440px] w-auto overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={c} stopOpacity="0" />
            <stop offset="1" stopColor={c} stopOpacity="0.55" />
          </linearGradient>
        </defs>

        <circle cx="200" cy="200" r="180" fill="none" stroke={c} strokeOpacity="0.25" />
        <circle
          cx="200"
          cy="200"
          r="130"
          fill="none"
          stroke={c}
          strokeOpacity="0.35"
          strokeDasharray="2 9"
        />
        <circle cx="200" cy="200" r="85" fill="none" stroke={c} strokeOpacity="0.25" />

        {/* sweep */}
        <g className="radar-spin" style={{ animationDuration: underAttack ? "1.6s" : "4s" }}>
          <path d="M200 200 L200 20 A180 180 0 0 1 327 73 Z" fill="url(#sweep)" />
        </g>

        {/* attack pulses */}
        {underAttack &&
          [0, 0.6, 1.2].map((d) => (
            <circle
              key={d}
              cx="200"
              cy="200"
              r="90"
              fill="none"
              stroke={c}
              className="radar-pulse"
              style={{ animationDelay: `${d}s` }}
            />
          ))}

        {/* satellites */}
        <g className="radar-spin" style={{ animationDuration: "18s" }}>
          <Satellite x={380} y={200} c={c} />
        </g>
        <g className="radar-spin-rev" style={{ animationDuration: "12s" }}>
          <Satellite x={292} y={292} c={c} small />
        </g>

        {/* shield */}
        <g className={underAttack ? "shield-shake" : ""}>
          <path
            d="M200 112 L262 134 L262 200 Q262 248 200 278 Q138 248 138 200 L138 134 Z"
            fill="var(--background)"
            fillOpacity="0.85"
            stroke={c}
            strokeWidth="3"
          />
          <path d="M200 112 V278 M138 165 H262 M140 215 H260" stroke={c} strokeOpacity="0.35" />
          {/* scales of justice */}
          <g stroke={c} strokeWidth="3" fill="none" strokeLinecap="round">
            <path d="M200 176 V206 M186 208 H214 M182 182 H218" />
            <path
              d="M182 182 L175 196 H189 Z M218 182 L211 196 H225 Z"
              fill={c}
              fillOpacity="0.9"
            />
          </g>
          <circle cx="200" cy="176" r="3" fill={c} />
        </g>
      </svg>
    </div>
  );
}

function Satellite({ x, y, c, small }: { x: number; y: number; c: string; small?: boolean }) {
  const s = small ? 0.7 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${s}) rotate(25)`}>
      <rect x="-5" y="-22" width="10" height="13" fill={c} fillOpacity="0.6" />
      <rect x="-6" y="-6" width="12" height="12" fill={c} />
      <rect x="-5" y="9" width="10" height="13" fill={c} fillOpacity="0.6" />
    </g>
  );
}
