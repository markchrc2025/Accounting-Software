// nexus-refined.jsx — refined Nexus mark + brand system for Sentire
// Exports (to window): NX, NexusMark, NexusLockupH, NexusLockupS,
//   NexusAppIcon, NexusProductLockup, NexusClearspace, NexusMinSize, NexusPalette

const NX = {
  ink: "#2A2420",
  inkOnDark: "#F7F3EF",
  core: "#D97757",
  slate: "#6B6259",
  dark: "#211A15",
  font: '"Instrument Sans", system-ui, sans-serif',
  products: ["Books", "Payroll", "Tax", "POS"],
  productColors: { Books: "#C7913D", Payroll: "#4F9373", Tax: "#A0627D", POS: "#5E7FB1" },
  productColorsOnDark: { Books: "#E0B566", Payroll: "#7FC4A6", Tax: "#C98FA9", POS: "#8FAEDC" },
};

// mix a hex toward white
function nxLighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(c + (255 - c) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function nxTint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// node layouts: [angleDeg, radius, sizeFactor]
const NX_LAYOUTS = {
  constellation: [[-90, 12.5, 1.05], [0, 14.5, 1.18], [110, 13, 1.1], [200, 14, 0.98]],
  balanced:      [[-70, 13.5, 1.08], [20, 13.5, 1.08], [110, 13.5, 1.08], [200, 13.5, 1.08]],
  badge:         [[-70, 13.5, 1.08], [20, 13.5, 1.08], [110, 13.5, 1.08], [200, 13.5, 1.08]],
  mesh:          [[-90, 12.5, 1.05], [0, 14.5, 1.18], [110, 13, 1.1], [200, 14, 0.98]],
};

function NexusMark({
  variant = "constellation", size = 48, onDark = false,
  lit = -1, litColor, nodeScale = 1, lineW = 2.6, core,
}) {
  const ink = onDark ? NX.inkOnDark : NX.ink;
  const baseCore = core || NX.core;
  const coreCol = onDark ? nxLighten(baseCore, 0.28) : baseCore;
  const pts = NX_LAYOUTS[variant].map(([a, r, f]) => {
    const t = (a * Math.PI) / 180;
    return { x: 24 + r * Math.cos(t), y: 24 + r * Math.sin(t), f };
  });
  const isBadge = variant === "badge";
  const isMesh = variant === "mesh";
  const inner = (
    <g transform={isBadge ? "translate(24 24) scale(0.72) translate(-24 -24)" : undefined}>
      {pts.map((p, i) => (
        <line key={"l" + i} x1="24" y1="24" x2={p.x} y2={p.y}
              stroke={ink} strokeWidth={lineW} opacity="0.5" strokeLinecap="round" />
      ))}
      {isMesh && pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return <line key={"m" + i} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                     stroke={ink} strokeWidth={lineW * 0.75} opacity="0.18" strokeLinecap="round" />;
      })}
      {pts.map((p, i) => (
        <circle key={"n" + i} cx={p.x} cy={p.y}
                r={3.5 * p.f * nodeScale * (i === lit ? 1.3 : 1)}
                fill={i === lit ? (litColor || coreCol) : ink} />
      ))}
      <circle cx="24" cy="24" r={5 * nodeScale} fill={coreCol} />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Sentire Nexus mark">
      {isBadge && (
        <rect x="4.2" y="4.2" width="39.6" height="39.6" rx="11.5"
              stroke={ink} strokeWidth="2.4" opacity="0.85" />
      )}
      {inner}
    </svg>
  );
}

function NexusWord({ size = 36, onDark = false, sub, subColor }) {
  return (
    <span style={{
      fontFamily: NX.font, fontWeight: 600, fontSize: size,
      letterSpacing: "-0.02em", lineHeight: 1, whiteSpace: "nowrap",
      color: onDark ? NX.inkOnDark : NX.ink,
    }}>
      Sentire{sub ? <span style={{ fontWeight: 500, color: subColor || NX.slate }}> {sub}</span> : null}
    </span>
  );
}

function NexusLockupH({ variant, onDark, nodeScale, lineW, core, markSize = 48, wordSize = 36 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(markSize * 0.27) }}>
      <NexusMark variant={variant} size={markSize} onDark={onDark} nodeScale={nodeScale} lineW={lineW} core={core} />
      <NexusWord size={wordSize} onDark={onDark} />
    </div>
  );
}

function NexusLockupS({ variant, onDark, nodeScale, lineW, core }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <NexusMark variant={variant} size={62} onDark={onDark} nodeScale={nodeScale} lineW={lineW} core={core} />
      <NexusWord size={27} onDark={onDark} />
    </div>
  );
}

function NexusAppIcon({ variant, size = 116, nodeScale, lineW, core }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.235, flex: "none",
      background: `linear-gradient(150deg, #2E241C 0%, ${NX.dark} 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 10px 24px -12px rgba(26,18,12,0.5), inset 0 1px 0 rgba(255,255,255,0.09)",
    }}>
      <NexusMark variant={variant} size={size * 0.66} onDark
                 nodeScale={nodeScale} lineW={lineW} core={core} />
    </div>
  );
}

// product sub-logo: glyph chip, color-coded per product
function NexusProductLockup({ product, onDark, core }) {
  const pc = onDark ? NX.productColorsOnDark[product] : NX.productColors[product];
  const pcBase = NX.productColors[product];
  const ink = onDark ? NX.inkOnDark : NX.ink;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{
        width: 38, height: 38, borderRadius: 10, flex: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: onDark ? "rgba(255,255,255,0.07)" : nxTint(pcBase, 0.11),
        border: `1px solid ${onDark ? "rgba(255,255,255,0.14)" : nxTint(pcBase, 0.26)}`,
      }}>
        <ProductGlyph product={product} color={ink} accent={pc} size={21} />
      </span>
      <NexusWord size={21} onDark={onDark} sub={product} subColor={pc} />
    </div>
  );
}

// ---- guideline cards --------------------------------------------------------
function NexusClearspace({ variant, core }) {
  const pad = 20; // = core diameter at 96px mark
  return (
    <div className="nx-guide">
      <div style={{
        padding: pad, border: "1.5px dashed #d4ccc2", borderRadius: 4,
        position: "relative",
      }}>
        <NexusMark variant={variant} size={96} core={core} />
        <span className="nx-guide-x" style={{ top: -9, left: "50%" }}>x</span>
        <span className="nx-guide-x" style={{ top: "50%", left: -6 }}>x</span>
      </div>
      <p>Clear space = x on all sides,<br />where x is the core's diameter.</p>
    </div>
  );
}

function NexusMinSize({ variant, core }) {
  return (
    <div className="nx-guide">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 26 }}>
        {[48, 32, 24, 16].map((s) => (
          <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <NexusMark variant={variant} size={s} core={core} />
            <span className="nx-guide-px">{s}px</span>
          </div>
        ))}
      </div>
      <p>Mark stays legible to 16px.<br />Below 24px, use the mark without the wordmark.</p>
    </div>
  );
}

function NexusPalette({ core }) {
  const sw = [
    { n: "Ink", h: NX.ink }, { n: "Core orange", h: core || NX.core },
    { n: "Warm slate", h: NX.slate }, { n: "Sand", h: "#F2ECE4" },
    { n: "Books", h: NX.productColors.Books }, { n: "Payroll", h: NX.productColors.Payroll },
    { n: "Tax", h: NX.productColors.Tax }, { n: "POS", h: NX.productColors.POS },
  ];
  return (
    <div className="nx-palette">
      {sw.map((s) => (
        <div key={s.n} className="nx-swatch">
          <i style={{ background: s.h, boxShadow: s.h === "#F2ECE4" ? "inset 0 0 0 1px #e0d8cc" : "none" }}></i>
          <b>{s.n}</b><span>{s.h}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, {
  NX, NexusMark, NexusWord, NexusLockupH, NexusLockupS,
  NexusAppIcon, NexusProductLockup, NexusClearspace, NexusMinSize, NexusPalette,
});
