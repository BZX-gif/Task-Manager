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
        display: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'sans-serif'],
        body: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        // Warm graphite surfaces — mirrors the semantic tokens in style.css.
        base: { 950: '#080808', 900: '#101010', 850: '#151515', 800: '#1c1c1c', 700: '#242424' },
        // Ember is the signature Command accent; semantic states stay distinct.
        accent: { DEFAULT: '#f0783e', 2: '#f0783e', 3: '#8ac6ad', 4: '#d7b582', 5: '#e39b9b' },
        white: '#f5f1eb',
        slate: { 100: '#f5f1eb', 200: '#f5f1eb', 300: '#aaa6a0', 400: '#aaa6a0', 500: '#77736f', 600: '#77736f' },
        emerald: { 300: '#8ac6ad', 400: '#8ac6ad' },
        amber: { 200: '#e6cf9f', 300: '#d7b582', 400: '#d7b582' },
        violet: { 500: '#f0783e' },
      },

    },
  },
  plugins: [],
}
