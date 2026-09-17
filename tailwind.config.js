/**
 * Tailwind is compiled at build time (`npm run build:client`) instead of being
 * loaded from https://cdn.tailwindcss.com — that removes the production console
 * warning and makes the utility CSS part of the offline PWA shell.
 *
 * v2.3: the utility palette is remapped onto the design-system tokens in
 * style.css (calm blue accent, semantic success/warning/danger, no pure
 * black/white, no glow shadows, no decorative animations). Views use these
 * utilities; the tokens stay the single source of truth.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/index.tsx', './src/shell.ts', './src/client/**/*.{js,ts}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
      },
      colors: {
        base: { 950: '#0b0d11', 900: '#0f1217', 850: '#141820', 800: '#191e27', 700: '#1e242f' },
        accent: { DEFAULT: '#5b93e6', 2: '#7ba7ea', 3: '#57b28c', 4: '#cf9f5f', 5: '#d2797a' },
        /* Neutrals used as text in the views map onto the ink ramp. */
        slate: {
          100: '#eceef2',
          200: '#c2c8d2',
          300: '#aab3c0',
          400: '#828b99',
          500: '#6b7484',
          600: '#565e6c',
        },
        /* Semantic utility names used by the views, kept meaning-true. */
        emerald: { 400: '#57b28c' },
        amber: { 200: '#e0c193', 300: '#d8ad70', 400: '#cf9f5f' },
        rose: { 200: '#e8b4b5', 400: '#d2797a', 500: '#c25e60' },
        violet: { 500: '#5b93e6' },
        white: '#eceef2',
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.02) inset, 0 10px 28px -18px rgba(0,0,0,0.55)',
      },
    },
  },
  plugins: [],
}
