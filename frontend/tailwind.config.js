/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontSize: {
        'chat-body': ['11px', { lineHeight: '1.7' }],
        'chat-label': ['9px', { lineHeight: '1.35' }],
        'chat-meta': ['10px', { lineHeight: '1.45' }],
        'research-empty': ['12px', { lineHeight: '1.6' }],
      },
    },
  },
  plugins: [],
}
