/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'usc-red': '#990000',
        'usc-yellow': '#FFC72C',
        'dark-bg': '#18181b',      // true black/very dark gray
        'dark-bg-2': '#232326',   // slightly lighter for cards
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  plugins: [],
  }
}