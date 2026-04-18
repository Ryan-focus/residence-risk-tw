export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://residence-risk-web.pages.dev";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "https://api.residence-risk-web.pages.dev/v1";

export const SITE_NAME = "住址風險評估｜Residence Risk TW";

export const SITE_DESCRIPTION =
  "輸入台灣地址，免費查詢淹水（24h 350/500/650mm）與地震（活動斷層、土壤液化）風險的開源工具。資料來源：經濟部水利署、中央地質調查所、經濟部地質調查及礦業管理中心。僅供防災參考。";

export const SITE_KEYWORDS = [
  "住址風險",
  "台灣淹水",
  "淹水潛勢",
  "地震風險",
  "活動斷層",
  "土壤液化",
  "防災",
  "Residence Risk TW",
  "Taiwan flood risk",
  "Taiwan earthquake risk",
];
