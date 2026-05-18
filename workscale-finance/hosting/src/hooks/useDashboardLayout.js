// useDashboardLayout — manages react-grid-layout state with localStorage persistence
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'scalebooks.dashboard.layout.v2';

// ─── Default 12-col layout ────────────────────────────────────────────────────
// Row 1: A(3) B(3) C(6)
// Row 2: D(4) E(4) F(2) G(2)
// Row 3: H(6) I(6)
// Row 4: J(3)
export const DEFAULT_LAYOUT = [
  { i: 'A', x: 0,  y: 0,  w: 3, h: 6,  minW: 2, minH: 5  },
  { i: 'B', x: 3,  y: 0,  w: 3, h: 6,  minW: 2, minH: 5  },
  { i: 'C', x: 6,  y: 0,  w: 6, h: 6,  minW: 4, minH: 5  },
  { i: 'D', x: 0,  y: 6,  w: 4, h: 8,  minW: 3, minH: 6  },
  { i: 'E', x: 4,  y: 6,  w: 4, h: 8,  minW: 3, minH: 6  },
  { i: 'F', x: 8,  y: 6,  w: 2, h: 8,  minW: 2, minH: 6  },
  { i: 'G', x: 10, y: 6,  w: 2, h: 8,  minW: 2, minH: 6  },
  { i: 'H', x: 0,  y: 14, w: 6, h: 8,  minW: 4, minH: 6  },
  { i: 'I', x: 6,  y: 14, w: 6, h: 8,  minW: 4, minH: 6  },
  { i: 'J', x: 0,  y: 22, w: 3, h: 5,  minW: 2, minH: 4  },
];

function layoutsEqual(a, b) {
  if (a.length !== b.length) return false;
  const bMap = Object.fromEntries(b.map(item => [item.i, item]));
  return a.every(item => {
    const other = bMap[item.i];
    return other && item.x === other.x && item.y === other.y && item.w === other.w && item.h === other.h;
  });
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_LAYOUT;
}

export function useDashboardLayout() {
  const [layout,    setLayoutState] = useState(loadSaved);
  const [pending,   setPending]     = useState(null); // layout during edit, not yet saved

  const isCustomised = !layoutsEqual(layout, DEFAULT_LAYOUT);

  const setLayout = useCallback((next) => {
    setPending(next);
  }, []);

  const saveLayout = useCallback(() => {
    if (pending) {
      setLayoutState(pending);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pending)); } catch {}
      setPending(null);
    }
  }, [pending]);

  const resetLayout = useCallback(() => {
    setLayoutState(DEFAULT_LAYOUT);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setPending(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setPending(null);
  }, []);

  return {
    layout: pending ?? layout,
    savedLayout: layout,
    isCustomised,
    setLayout,
    saveLayout,
    resetLayout,
    cancelEdit,
  };
}
