export const tokens = {
  colors: {
    bg: {
      primary: "#03050A",
      secondary: "#0A152A",
      tertiary: "#1E2A3B",
      hover: "#253448",
      chat: "#010208"
    },
    text: {
      primary: "#C5DAED",
      secondary: "#7CA7D1",
      muted: "#4A6A8A",
      heading: "#FFFFFF"
    },
    accent: {
      amber: "#F5A623",
      amberHover: "#D4891C",
      amberLight: "#FDF0D5"
    },
    ui: {
      steel: "#325D87",
      sky: "#7CA7D1",
      border: "#162840"
    },
    status: {
      success: "#2DCE89",
      danger: "#F5365C",
      dangerBg: "rgba(245, 54, 92, 0.1)",
      dangerBorder: "rgba(245, 54, 92, 0.3)"
    }
  },
  typography: {
    fontFamily: {
      heading: ["Montserrat", "sans-serif"],
      body: ["Questrial", "sans-serif"],
      mono: [
        "ui-monospace",
        "SFMono-Regular",
        "Menlo",
        "Monaco",
        "Consolas",
        "monospace"
      ]
    },
    fontSize: {
      xs: "11px",
      sm: "12px",
      base: "15px",
      lg: "16px",
      xl: "20px",
      "2xl": "24px",
      "3xl": "32px"
    },
    fontWeight: {
      normal: "400",
      medium: "500",
      semibold: "600",
      bold: "700"
    }
  },
  spacing: {
    sidebarExpanded: "300px",
    sidebarCollapsed: "48px",
    chatMaxWidth: "780px",
    mobileDrawer: "280px",
    composerRadius: "24px",
    bubbleRadius: "18px",
    cardRadius: "12px",
    inputRadius: "8px"
  },
  icons: {
    stroke: "#7CA7D1",
    strokeWidth: 1.5,
    size: {
      sm: 14,
      md: 18,
      lg: 28
    }
  }
} as const;

export type Tokens = typeof tokens;
