// sentire-logos.jsx — Sentire brand logo system (3 directions)
// Exports (to window): SENTIRE_DIRS, SentireMark, SentireWordmark, LockupH,
//   LockupStacked, AppIconBoard, ProductBoard

const SENTIRE_DIRS = {
  pulse: {
    key: "pulse", name: "Pulse",
    ink: "#0E1B2A", accent: "#0F7A52",
    inkOnDark: "#F4F6F9", accentOnDark: "#3FD08F",
    dark: "#0B1622",
    font: '"Source Serif 4", Georgia, serif',
    weight: 600, tracking: "-0.01em", caps: false, sizeAdj: 1,
  },
  sine: {
    key: "sine", name: "Sine",
    ink: "#14283E", accent: "#B08C3D",
    inkOnDark: "#F5F4F0", accentOnDark: "#D9B25F",
    dark: "#101F30",
    font: '"Instrument Sans", system-ui, sans-serif',
    weight: 600, tracking: "-0.015em", caps: false, sizeAdj: 1,
  },
  meridian: {
    key: "meridian", name: "Meridian",
    ink: "#1A1B47", accent: "#4F6DF5",
    inkOnDark: "#F2F3FA", accentOnDark: "#8FA2FF",
    dark: "#13143A",
    font: '"Marcellus", Georgia, serif',
    weight: 400, tracking: "0.2em", caps: true, sizeAdj: 0.82,
  },
  arco: {
    key: "arco", name: "Arco",
    ink: "#18283A", accent: "#B08C3D",
    inkOnDark: "#F5F4F0", accentOnDark: "#D9B25F",
    dark: "#101C2B",
    font: '"Instrument Sans", system-ui, sans-serif',
    weight: 600, tracking: "-0.015em", caps: false, sizeAdj: 1,
  },
  cadence: {
    key: "cadence", name: "Cadence",
    ink: "#14283E", accent: "#0F7A52",
    inkOnDark: "#F4F6F9", accentOnDark: "#3FD08F",
    dark: "#0E1D2E",
    font: '"Instrument Sans", system-ui, sans-serif',
    weight: 600, tracking: "-0.015em", caps: false, sizeAdj: 1,
  },
  orbit: {
    key: "orbit", name: "Orbit",
    ink: "#0F2533", accent: "#0F8C7E",
    inkOnDark: "#F0F5F5", accentOnDark: "#3ED6C5",
    dark: "#0B1D28",
    font: '"Instrument Sans", system-ui, sans-serif',
    weight: 600, tracking: "-0.015em", caps: false, sizeAdj: 1,
  },
  nexus: {
    key: "nexus", name: "Nexus",
    ink: "#141A2E", accent: "#3E63DD",
    inkOnDark: "#F2F4FA", accentOnDark: "#7E9BFF",
    dark: "#10142A",
    font: '"Instrument Sans", system-ui, sans-serif',
    weight: 600, tracking: "-0.015em", caps: false, sizeAdj: 1,
  },
  strata: {
    key: "strata", name: "Strata",
    ink: "#1A2026", accent: "#0BA77D",
    inkOnDark: "#F1F4F3", accentOnDark: "#3BD6A8",
    dark: "#13191E",
    font: '"Instrument Sans", system-ui, sans-serif',
    weight: 600, tracking: "-0.015em", caps: false, sizeAdj: 1,
  },
};

// ---------------------------------------------------------------- marks
function SentireMark({ dir, size = 48, onDark = false }) {
  const d = SENTIRE_DIRS[dir];
  const ink = onDark ? d.inkOnDark : d.ink;
  const acc = onDark ? d.accentOnDark : d.accent;

  if (dir === "pulse") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Sentire mark">
        <circle cx="12" cy="24" r="4.5" fill={acc} />
        <path d="M18.77 15.33 A11 11 0 0 1 18.77 32.67" stroke={ink} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M22.47 10.6 A17 17 0 0 1 22.47 37.4" stroke={ink} strokeWidth="3.2" strokeLinecap="round" opacity="0.62" />
        <path d="M26.16 5.88 A23 23 0 0 1 26.16 42.12" stroke={ink} strokeWidth="3.2" strokeLinecap="round" opacity="0.32" />
      </svg>
    );
  }
  if (dir === "sine") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Sentire mark">
        <path d="M32 16 a8 8 0 1 0 -8 8" stroke={ink} strokeWidth="4.6" strokeLinecap="round" />
        <path d="M24 24 a8 8 0 1 1 -8 8" stroke={acc} strokeWidth="4.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (dir === "arco") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Sentire mark">
        <path d="M17 33 V24 A7 7 0 0 1 31 24 V33" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
        <path d="M11 38 V24 A13 13 0 0 1 37 24 V38" stroke={ink} strokeWidth="3.4" strokeLinecap="round" opacity="0.6" />
        <path d="M5 42 V24 A19 19 0 0 1 43 24 V42" stroke={ink} strokeWidth="3.4" strokeLinecap="round" opacity="0.28" />
        <circle cx="24" cy="30.5" r="3.2" fill={acc} />
      </svg>
    );
  }
  if (dir === "cadence") {
    const heights = [12, 22, 34, 26, 16];
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Sentire mark">
        {heights.map((h, i) => (
          <rect key={i} x={5.5 + i * 8} y={24 - h / 2} width="5" height={h} rx="2.5"
                fill={i === 2 ? acc : ink} opacity={i === 0 || i === 4 ? 0.45 : 1} />
        ))}
      </svg>
    );
  }
  if (dir === "orbit") {
    // ring with a 40° gap centred at -45°; sensing dot sits in the gap
    const r = 15, cx = 24, cy = 24;
    const a0 = (-25 * Math.PI) / 180, a1 = (295 * Math.PI) / 180;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const dx = cx + r * Math.cos((-45 * Math.PI) / 180), dy = cy + r * Math.sin((-45 * Math.PI) / 180);
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Sentire mark">
        <path d={`M${x0} ${y0} A${r} ${r} 0 1 1 ${x1} ${y1}`} stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
        <circle cx={dx} cy={dy} r="4.2" fill={acc} />
        <circle cx={cx} cy={cy} r="3.2" fill={ink} />
      </svg>
    );
  }
  if (dir === "nexus") {
    // hub + four product nodes (Books, Payroll, Tax, POS) — organic graph,
    // deliberately not an X/+ so it doesn't read as a letterform
    const nodes = [
      { a: -90, r: 12.5, s: 3.4 },
      { a: -5,  r: 14.5, s: 3.8 },
      { a: 105, r: 13,   s: 3.6 },
      { a: 195, r: 14,   s: 3.2 },
    ].map(({ a, r, s }) => {
      const t = (a * Math.PI) / 180;
      return { x: 24 + r * Math.cos(t), y: 24 + r * Math.sin(t), s };
    });
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Sentire mark">
        {nodes.map((n, i) => (
          <line key={"l" + i} x1="24" y1="24" x2={n.x} y2={n.y} stroke={ink} strokeWidth="2.2" opacity="0.45" />
        ))}
        {nodes.map((n, i) => (
          <circle key={"n" + i} cx={n.x} cy={n.y} r={n.s} fill={ink} />
        ))}
        <circle cx="24" cy="24" r="5" fill={acc} />
      </svg>
    );
  }
  if (dir === "strata") {
    // platform stack / full-signal meter
    const bars = [
      { x: 17, y: 11, w: 14, accent: true },
      { x: 12, y: 20.5, w: 24, accent: false },
      { x: 7, y: 30, w: 34, accent: false },
    ];
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Sentire mark">
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height="6" rx="3"
                fill={b.accent ? acc : ink} opacity={i === 2 ? 0.82 : 1} />
        ))}
      </svg>
    );
  }
  // meridian — radial dial
  const ticks = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * 30 - 90) * Math.PI / 180;
    const isTop = k === 0;
    const r1 = isTop ? 9.5 : 13.5;
    const r2 = 20;
    ticks.push(
      <line key={k}
        x1={24 + r1 * Math.cos(a)} y1={24 + r1 * Math.sin(a)}
        x2={24 + r2 * Math.cos(a)} y2={24 + r2 * Math.sin(a)}
        stroke={isTop ? acc : ink} strokeWidth={isTop ? 3 : 2.5} strokeLinecap="round" />
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Sentire mark">
      {ticks}
      <circle cx="24" cy="24" r="3.4" fill={ink} />
    </svg>
  );
}

// ---------------------------------------------------------------- wordmark
function SentireWordmark({ dir, size = 34, onDark = false, color }) {
  const d = SENTIRE_DIRS[dir];
  return (
    <span style={{
      fontFamily: d.font,
      fontWeight: d.weight,
      fontSize: size * d.sizeAdj,
      letterSpacing: d.tracking,
      textTransform: d.caps ? "uppercase" : "none",
      color: color || (onDark ? d.inkOnDark : d.ink),
      lineHeight: 1,
      whiteSpace: "nowrap",
    }}>Sentire</span>
  );
}

// ---------------------------------------------------------------- lockups
function LockupH({ dir, onDark = false, markSize = 46, wordSize = 36 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(markSize * 0.3) }}>
      <SentireMark dir={dir} size={markSize} onDark={onDark} />
      <SentireWordmark dir={dir} size={wordSize} onDark={onDark} />
    </div>
  );
}

function LockupStacked({ dir, onDark = false, markSize = 56, wordSize = 27 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: Math.round(markSize * 0.32) }}>
      <SentireMark dir={dir} size={markSize} onDark={onDark} />
      <SentireWordmark dir={dir} size={wordSize} onDark={onDark} />
    </div>
  );
}

// ---------------------------------------------------------------- app icon
function AppIconTile({ dir, size = 116 }) {
  const d = SENTIRE_DIRS[dir];
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.235,
      background: `linear-gradient(150deg, ${d.dark} 0%, ${d.ink} 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 10px 24px -12px rgba(10,18,30,0.45), inset 0 1px 0 rgba(255,255,255,0.09)",
      flex: "none",
    }}>
      <SentireMark dir={dir} size={size * 0.62} onDark />
    </div>
  );
}

function AppIconBoard({ dir }) {
  return (
    <div className="sl-iconboard">
      <AppIconTile dir={dir} size={116} />
      <div className="sl-icon-smalls">
        <AppIconTile dir={dir} size={56} />
        <AppIconTile dir={dir} size={32} />
        <AppIconTile dir={dir} size={20} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- product glyphs
function ProductGlyph({ product, color, accent, size = 22 }) {
  const sw = 1.8;
  const common = { fill: "none", stroke: color, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  if (product === "Books") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M12 6.6 C9.6 4.9 6.2 4.7 3.8 5.7 V17.9 C6.2 17 9.6 17.2 12 18.9 C14.4 17.2 17.8 17 20.2 17.9 V5.7 C17.8 4.7 14.4 4.9 12 6.6 Z" {...common} />
        <path d="M12 6.6 V18.9" {...common} stroke={accent} />
      </svg>
    );
  }
  if (product === "Payroll") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M19.8 13.2 A8 8 0 1 1 17.7 6.6" {...common} />
        <path d="M18.4 3.6 L17.9 7 L14.6 6.2" {...common} />
        <circle cx="12" cy="12" r="3.1" fill="none" stroke={accent} strokeWidth={sw} />
      </svg>
    );
  }
  if (product === "Tax") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M6 3.5 H14 L18.5 8 V20.5 H6 Z" {...common} />
        <path d="M14 3.5 V8 H18.5" {...common} />
        <circle cx="9.8" cy="12.1" r="1.25" fill={accent} stroke="none" />
        <circle cx="14.4" cy="16.7" r="1.25" fill={accent} stroke="none" />
        <path d="M14.9 11.6 L9.3 17.2" stroke={accent} strokeWidth={sw} strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  // POS terminal
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="7" y="3.5" width="10" height="17" rx="2.2" {...common} />
      <path d="M9.6 7.2 H14.4" stroke={accent} strokeWidth={sw} strokeLinecap="round" fill="none" />
      <circle cx="10" cy="12" r="0.9" fill={color} stroke="none" />
      <circle cx="14" cy="12" r="0.9" fill={color} stroke="none" />
      <circle cx="10" cy="15.6" r="0.9" fill={color} stroke="none" />
      <circle cx="14" cy="15.6" r="0.9" fill={color} stroke="none" />
    </svg>
  );
}

// hex -> rgba tint
function slTint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function ProductLockup({ dir, product, onDark = false }) {
  const d = SENTIRE_DIRS[dir];
  const ink = onDark ? d.inkOnDark : d.ink;
  const acc = onDark ? d.accentOnDark : d.accent;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
      <span style={{
        width: 38, height: 38, borderRadius: 10, flex: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: onDark ? "rgba(255,255,255,0.07)" : slTint(d.accent, 0.09),
        border: `1px solid ${onDark ? "rgba(255,255,255,0.14)" : slTint(d.accent, 0.22)}`,
      }}>
        <ProductGlyph product={product} color={ink} accent={acc} size={21} />
      </span>
      <span style={{
        fontFamily: d.font, fontWeight: d.weight,
        fontSize: 21 * d.sizeAdj, letterSpacing: d.tracking,
        textTransform: d.caps ? "uppercase" : "none",
        color: ink, lineHeight: 1, whiteSpace: "nowrap",
      }}>
        Sentire <span style={{ color: acc }}>{product}</span>
      </span>
    </div>
  );
}

function ProductBoard({ dir, onDark = false }) {
  return (
    <div className="sl-products">
      {["Books", "Payroll", "Tax", "POS"].map((p) => (
        <ProductLockup key={p} dir={dir} product={p} onDark={onDark} />
      ))}
    </div>
  );
}

Object.assign(window, {
  SENTIRE_DIRS, SentireMark, SentireWordmark,
  LockupH, LockupStacked, AppIconTile, AppIconBoard,
  ProductGlyph, ProductLockup, ProductBoard,
});
