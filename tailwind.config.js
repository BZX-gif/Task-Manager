/**
 * Tailwind is compiled at build time (`npm run build:client`) instead of being
 * loaded from https://cdn.tailwindcss.com — that removes the production console
 * warning and makes the utility CSS part of the offline PWA shell.
 *
 * The theme below mirrors the previous runtime `tailwind.config` that used to
 * live inline in the HTML shell, using the restrained Command palette. Semantic CSS variables remain the source of truth.
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
        display: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', 'Roboto', 'sans-serif'],
        body: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        // Midnight ink surfaces — mirrors the semantic tokens in style.css.
        base: { 950: '#090B10', 900: '#0D1017', 850: '#12161F', 800: '#181D28', 700: '#202634' },
        // Ember is the signature Command accent; semantic states stay distinct.
        accent: { DEFAULT: '#FF8A4C', 2: '#FF8A4C', 3: '#7FC9A8', 4: '#E2BC85', 5: '#EFA0A0' },
        white: '#EEF1F7',
        slate: { 100: '#EEF1F7', 200: '#EEF1F7', 300: '#AFB7C9', 400: '#AFB7C9', 500: '#939CB0', 600: '#939CB0' },
        emerald: { 300: '#7FC9A8', 400: '#7FC9A8' },
        amber: { 200: '#E2BC85', 300: '#E2BC85', 400: '#E2BC85' },
        violet: { 500: '#FF8A4C' },
      },

    },
  },
  plugins: [],
}
