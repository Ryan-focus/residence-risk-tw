import { ImageResponse } from "next/og";

export const alt = "Residence Risk TW — 台灣住址風險評估";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 50%, #0ea5e9 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 40, opacity: 0.85, letterSpacing: 2 }}>
          Residence Risk TW
        </div>
        <div
          style={{
            fontSize: 92,
            fontWeight: 800,
            lineHeight: 1.1,
            marginTop: 16,
          }}
        >
          住址風險評估
        </div>
        <div
          style={{
            fontSize: 36,
            opacity: 0.9,
            marginTop: 32,
            lineHeight: 1.3,
          }}
        >
          輸入台灣地址 → 淹水 × 地震風險
        </div>
        <div
          style={{
            fontSize: 24,
            opacity: 0.75,
            marginTop: 40,
            display: "flex",
            gap: 24,
          }}
        >
          <span>經濟部水利署</span>
          <span>·</span>
          <span>活動斷層敏感區</span>
          <span>·</span>
          <span>土壤液化潛勢</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
