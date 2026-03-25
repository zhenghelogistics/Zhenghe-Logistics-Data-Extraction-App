/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary:                  '#091426',
        'primary-container':      '#1e293b',
        secondary:                '#00668a',
        'secondary-container':    '#40c2fd',
        'secondary-fixed':        '#c4e7ff',
        'on-secondary-container': '#004d6a',
        surface:                  '#f7f9fb',
        'surface-low':            '#f2f4f6',
        'surface-container':      '#e6e8ea',
        'surface-lowest':         '#ffffff',
        outline:                  '#c5c6cd',
      },
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
