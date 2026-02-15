/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        accent: '#6366f1',
        'accent-soft': '#eef2ff',
        green: {
          DEFAULT: '#16a34a',
          soft: '#f0fdf4',
        },
        red: {
          DEFAULT: '#dc2626',
          soft: '#fef2f2',
        },
        ink: {
          DEFAULT: '#1a1a2e',
          soft: '#4a4a6a',
          muted: '#9a9ab0',
        },
        surface: '#f5f5fa',
        border: '#e8e8f0',
      },
      borderRadius: {
        DEFAULT: '12px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(26,26,46,0.06)',
      },
    },
  },
  plugins: [],
}
