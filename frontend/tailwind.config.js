/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark cinematic palette (design system: bg #0F172A, accent blue/indigo)
        brand: {
          DEFAULT: '#6366F1', // indigo-500
          hover: '#818CF8',   // indigo-400
          dim: '#4338CA',     // indigo-700
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
