/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── ScaleBooks brand tokens ──────────────────────────────────
        sb: {
          primary:           '#F97316',
          'primary-hover':   '#EA580C',
          'primary-subtle':  '#FFF7ED',
          text:              '#1F2937',
          'text-muted':      '#6B7280',
          'text-placeholder':'#9CA3AF',
          border:            '#E5E7EB',
          'border-subtle':   '#F3F4F6',
          surface:           '#FFFFFF',
          bg:                '#F9FAFB',
          info:              '#2563EB',
          success:           '#16A34A',
          warning:           '#D97706',
          danger:            '#DC2626',
        },
        // ── shadcn/ui tokens (kept for existing components) ──────────
        border:     'hsl(var(--border))',
        input:      'hsl(var(--input))',
        ring:       'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary:    { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary:  { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted:      { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent:     { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive:{ DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        popover:    { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card:       { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        pill: '9999px',
        card: '12px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        'widget-label': ['11px', { fontWeight: '600', letterSpacing: '0.05em' }],
        metric:         ['28px', { fontWeight: '600' }],
      },
    },
  },
  plugins: [],
};
