/**
 * Tailwind is compiled at build time (`npm run build:client`) instead of being
 * loaded from https://cdn.tailwindcss.com — that removes the production console
 * warning and makes the utility CSS part of the offline PWA shell.
 *
 * The theme below mirrors the previous runtime `tailwind.config` that used to
 * live inline in the HTML shell, so the visual design is unchanged.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/index.tsx',
    './src/shell.js',
    './src/client/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
      },
      colors: {
        base: { 950: '#05070d', 900: '#0a0e1a', 850: '#0e1424', 800: '#131a2e', 700: '#1b2440' },
        accent: { DEFAULT: '#7c5cff', 2: '#22d3ee', 3: '#34d399', 4: '#fbbf24', 5: '#fb7185' },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124,92,255,0.15), 0 8px 30px -6px rgba(124,92,255,0.35)',
        card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 20px 40px -20px rgba(0,0,0,0.6)',
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0px)' }, '50%': { transform: 'translateY(-8px)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
    },
  },
  plugins: [],
}
