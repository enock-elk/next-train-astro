/** @type {import('tailwindcss').Config} */
export default {
  // 1. Tell Tailwind EXACTLY where our class names are located.
  //    public/js/*.js are classic scripts (admin panel, map app) that inject
  //    Tailwind markup at runtime — omitting them silently drops their classes.
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
    './public/js/**/*.js',
  ],
  
  // 2. Enable manual dark mode toggling via the 'dark' class on the <html> tag
  darkMode: 'class',
  
  theme: {
    extend: {
      // Phase 3: blue-* follows --nt-blue-* from appearance packs (alerts stay semantic)
      colors: {
        blue: {
          50: 'rgb(var(--nt-blue-50) / <alpha-value>)',
          100: 'rgb(var(--nt-blue-100) / <alpha-value>)',
          200: 'rgb(var(--nt-blue-200) / <alpha-value>)',
          300: 'rgb(var(--nt-blue-300) / <alpha-value>)',
          400: 'rgb(var(--nt-blue-400) / <alpha-value>)',
          500: 'rgb(var(--nt-blue-500) / <alpha-value>)',
          600: 'rgb(var(--nt-blue-600) / <alpha-value>)',
          700: 'rgb(var(--nt-blue-700) / <alpha-value>)',
          800: 'rgb(var(--nt-blue-800) / <alpha-value>)',
          900: 'rgb(var(--nt-blue-900) / <alpha-value>)',
        },
      },
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