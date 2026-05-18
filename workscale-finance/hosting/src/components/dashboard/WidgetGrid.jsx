// WidgetGrid — react-grid-layout powered widget canvas
import { useRef, useState, useEffect } from 'react';
import ReactGridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

export function WidgetGrid({ layout, widgets, isCustomising, onLayoutChange }) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="mb-6">
      <h2 className="text-[18px] font-semibold text-[#1F2937] mb-4">Business at a glance</h2>
      <div ref={containerRef} style={{ width: '100%' }}>
        {containerWidth > 0 && (
          <ReactGridLayout
            layout={layout}
            cols={12}
            width={containerWidth}
            rowHeight={24}
            margin={[14, 14]}
            isDraggable={isCustomising}
            isResizable={isCustomising}
            onLayoutChange={(next) => onLayoutChange && onLayoutChange(next)}
            draggableHandle=".widget-drag-handle"
          >
            {layout.map(item => {
              const Widget = widgets[item.i];
              if (!Widget) return null;
              return (
                <div key={item.i} className="relative group">
                  {isCustomising && (
                    <div className="widget-drag-handle absolute inset-0 cursor-move z-10 rounded-xl ring-2 ring-[#F97316]/30 ring-inset" />
                  )}
                  <Widget isCustomising={isCustomising} />
                </div>
              );
            })}
          </ReactGridLayout>
        )}
      </div>
    </div>
  );
}
