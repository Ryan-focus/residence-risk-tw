import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        risk: {
          lowest: "#22c55e",
          low: "#84cc16",
          medium: "#eab308",
          high: "#f97316",
          highest: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};
export default config;
