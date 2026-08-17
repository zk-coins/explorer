import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#000000',
        ink: '#ffffff',
        ink2: '#a1a1aa',
        ink3: '#909099',
        ink4: '#3f3f46',
        line: '#1c1c1c',
        line2: '#262626',
        surface: '#0c0c0c',
        bitcoin: {
          DEFAULT: '#f7931a',
          hover: '#ff9f2a',
          dim: '#c9761a',
        },
        bad: '#ef4444',
        ok: '#22c55e',
        warn: '#eab308',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
