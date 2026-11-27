/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f7f4ed',
        ink: '#191c1a',
        brand: '#1e6b4f',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
