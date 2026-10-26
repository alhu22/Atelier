import type { Config } from "tailwindcss";
import theme from "./src/styles/theme.json";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: theme },
  plugins: [],
} satisfies Config;
