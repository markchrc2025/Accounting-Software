// WidgetGrid — widget canvas
// Static view uses plain CSS grid for exact, predictable heights.
// Customise mode switches to react-grid-layout for drag/resize.
import { useRef, useState, useEffect } from 'react';
import ReactGridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ROW_PX  = 36; // px per h-unit  →  h=5 ≈ 180px, h=6 ≈ 216px, h=8 ≈ 288px
const GAP_PX  = 14;

export function WidgetGrid({ layout, widgets, isCustomising, onLayoutChange }) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const title = (
    <h2 className="text-[18px] font-semibold text-[#1F2937] mb-4">Business at a glance</h2>
  );

  // ── Customise mode: use react-grid-layout for drag/resize ──────────────────
  if (isCustomising) {
    return (
      <div className="mb-6">
        {title}
        <div ref={containerRef} style={{ width: '100%' }}>
          {containerWidth > 0 && (
            <ReactGridLayout
              layout={layout}
              cols={12}
              width={containerWidth}
              rowHeight={ROW_PX}
              margin={[GAP_PX, GAP_PX]}
              isDraggable
              isResizable
              onLayoutChange={(next) => onLayoutChange && onLayoutChange(next)}
              draggableHandle=".widget-drag-handle"
            >
              {layout.map(item => {
                const Widget = widgets[item.i];
                if (!Widget) return null;
                return (
                  <div key={item.i} className="relative group">
                    <div className="widget-drag-handle absolute inset-0 cursor-move z-10 rounded-xl ring-2 ring-[#F97316]/30 ring-inset" />
                    <Widget isCustomising />
                  </div>
                );
              })}
            </ReactGridLayout>
          )}
        </div>
      </div>
    );
  }

  // ── Static view: plain CSS grid — heights are exactly h × ROW_PX ──────────
  const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);

  return (
    <div className="mb-6">
      {title}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: `${GAP_PX}px`,
          alignItems: 'start',
        }}
      >
        {sorted.map(item => {
          const Widget = widgets[item.i];
          if (!Widget) return null;
          return (
            <div
              key={item.i}
              style={{ gridColumn: `span ${item.w}`, height: `${item.h * ROW_PX}px` }}
            >
              <Widget isCustomising={false} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
