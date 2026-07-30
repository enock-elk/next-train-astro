/** @type {import('tailwindcss').Config} */
export default {
  // 1. Tell Tailwind EXACTLY where our class names are located
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  
  // 2. Enable manual dark mode toggling via the 'dark' class on the <html> tag
  darkMode: 'class',
  
  theme: {
    extend: {
      // We can add custom animations or brand colors here later if needed
      animation: {
        'fade-in-up': 'fadeInUp 0.4s ease-out forwards',
        'shake': 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shake: {
          '10%, 90%': { transform: 'translate3d(-1px, 0, 0)' },
          '20%, 80%': { transform: 'translate3d(2px, 0, 0)' },
          '30%, 50%, 70%': { transform: 'translate3d(-4px, 0, 0)' },
          '40%, 60%': { transform: 'translate3d(4px, 0, 0)' }
        }
      }
    },
  },
  plugins: [],
}