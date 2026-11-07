/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0c0c0c",
        panel: "#161616",
        panel2: "#1e1e1e",
        line: "#2a2a2a",
        ink: "#f3f3f0",
        muted: "#a1a19b",
        faint: "#6c6c67",
        accent: { DEFAULT: "#f2875f", hover: "#f59b79", soft: "#f2875f26" },
        lime: { DEFAULT: "#cfdc7c", soft: "#cfdc7c22" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
};
