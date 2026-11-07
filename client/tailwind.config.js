/** @type {import('tailwindcss').Config} */
// Thème Vert-ardoise : "brand" pointe vers les jetons sarcelle (--tk-accent-*)
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--tk-rgb-accent-700) / <alpha-value>)', // #0f766e : boutons, états actifs
          dark: 'rgb(var(--tk-rgb-accent-800) / <alpha-value>)',    // #134e4a
          light: 'var(--tk-accent-50)'     // #f0fdfa
        }
      },
      fontFamily: { sans: ['Inter', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
};
