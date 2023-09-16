import {nextui} from '@nextui-org/theme'
import theme from "tailwindcss/defaultTheme";

const colors = require('tailwindcss/colors')
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        lightBlue: colors.sky,
        warmGray: colors.stone,
        trueGray: colors.neutral,
        coolGray: colors.gray,
        blueGray: colors.slate
      },
    },
  },
  darkMode: "class",
  variants: {},
  plugins: [nextui()],
  xwind: {
    mode: 'objectstyles',
  },
}
