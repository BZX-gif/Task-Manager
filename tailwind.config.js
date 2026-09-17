/**
 * Tailwind is compiled at build time (`npm run build:client`) instead of being
 * loaded from https://cdn.tailwindcss.com — that removes the production console
 * warning and makes the utility CSS part of the offline PWA shell.
 *
 * The theme below mirrors the previous runtime `tailwind.config` that used to
 * live inline in the HTML shell, using the restrained v2.3 palette.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/index.tsx',
    './src/shell.ts',
    './src/client/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
      },
      colors: {
        base: { 950: '#0b0d11', 900: '#0f1217', 850: '#141820', 800: '#191e27', 700: '#1e242f' },
        accent: { DEFAULT: '#5b93e6', 2: '#5b93e6', 3: '#57b28c', 4: '#cf9f5f', 5: '#d2797a' },
        white: '#eceef2',
        slate: { 100: '#eceef2', 200: '#eceef2', 300: '#c2c8d2', 400: '#a0a8b5', 500: '#828b99', 600: '#828b99' },
        emerald: { 300: '#57b28c', 400: '#57b28c' },
        amber: { 300: '#cf9f5f', 400: '#cf9f5f' },
        violet: { 500: '#5b93e6' },
      },

    },
  },
  plugins: [],
}
