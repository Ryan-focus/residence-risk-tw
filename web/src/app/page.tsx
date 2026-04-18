import Link from "next/link";
import AssessApp from "@/components/AssessApp";
import DisclaimerBanner from "@/components/DisclaimerBanner";
import Footer from "@/components/Footer";
import { SITE_URL, SITE_NAME } from "@/lib/site";

const FAQS: { q: string; a: string }[] = [
  {
    q: "這份評估結果可以當作買房或保險依據嗎？",
    a: "不可以。本工具使用經濟部水利署、中央地質調查所等政府公開資料，依《水災潛勢資料公開辦法》此資料僅供防災業務參考，不構成任何土地使用、不動產交易、保險核保或金融授信的決策依據。",
  },
  {
    q: "支援哪些風險項目？",
    a: "目前支援淹水風險（24 小時 350／500／650mm 三種降雨情境）與地震風險（活動斷層地質敏感區 + 土壤液化潛勢）。空氣品質、土石流等面向列於開發路線中。",
  },
  {
    q: "我的地址會被儲存嗎？",
    a: "不會。地址僅以 SHA-256 hash 形式存於 30 天地理編碼快取中，用以節省 Nominatim / 圖霸 Map8 的 API 呼叫次數。原始地址與座標對應不會外流。",
  },
  {
    q: "資料更新頻率？",
    a: "以政府公開資料平台 data.gov.tw 的釋出節奏為準，通常為每年一次大版本。可透過 GET /v1/meta/versions API 取得目前匯入的各資料源版本與匯入時間。",
  },
  {
    q: "可以接入成自己的 App 或 AI Agent 嗎？",
    a: "可以。API 以 REST JSON 提供，並公開 /v1/openapi.json（OpenAPI 3.1）與 /.well-known/ai-plugin.json，支援 Claude Agent SDK、ChatGPT Actions 等主流 agent 框架直接綁定。MCP server 端點為 /mcp。",
  },
];

const RISK_LEVELS = [
  { score: "81–100", label: "極高", color: "#ef4444" },
  { score: "61–80", label: "高", color: "#f97316" },
  { score: "41–60", label: "中", color: "#eab308" },
  { score: "21–40", label: "低", color: "#84cc16" },
  { score: "0–20", label: "極低", color: "#22c55e" },
];

export default function Home() {
  const webAppJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    alternateName: "Residence Risk TW",
    url: SITE_URL,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    inLanguage: "zh-Hant-TW",
    isAccessibleForFree: true,
    description:
      "輸入台灣地址即可查詢淹水（24h 350/500/650mm）與地震（活動斷層、土壤液化）風險的免費開源工具，資料來源為經濟部水利署與中央地質調查所。",
    offers: { "@type": "Offer", price: "0", priceCurrency: "TWD" },
    creator: {
      "@type": "Organization",
      name: "Residence Risk TW contributors",
      url: "https://github.com/Ryan-focus/residence-risk-tw",
    },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  const datasetJsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "台灣淹水潛勢圖 (24h 350/500/650mm)",
      description: "經濟部水利署發布之各縣市淹水潛勢圖資，依降雨情境呈現淹水深度分級。",
      license: "https://data.gov.tw/license",
      isAccessibleForFree: true,
      url: "https://data.gov.tw/dataset/25766",
      creator: { "@type": "GovernmentOrganization", name: "經濟部水利署" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "活動斷層地質敏感區",
      url: "https://data.gov.tw/dataset/100220",
      license: "https://data.gov.tw/license",
      creator: { "@type": "GovernmentOrganization", name: "中央地質調查所" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "土壤液化潛勢圖",
      url: "https://data.gov.tw/dataset/28691",
      license: "https://data.gov.tw/license",
      creator: {
        "@type": "GovernmentOrganization",
        name: "經濟部地質調查及礦業管理中心",
      },
    },
  ];

  return (
    <>
      <DisclaimerBanner />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-4 py-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">住址風險評估｜Residence Risk TW</h1>
          <p className="text-sm text-gray-600">
            整合經濟部水利署淹水潛勢圖、中央地質調查所活動斷層地質敏感區、經濟部地調所土壤液化潛勢圖，輸入台灣任一地址即可取得
            0–100 分的五級風險評估。資料來源皆為
            <Link
              href="https://data.gov.tw/"
              className="underline hover:text-gray-800"
            >
              政府資料開放平台
            </Link>
            ，免費、開源、可自架。
          </p>
        </header>

        <section aria-labelledby="assess-heading" className="space-y-5">
          <h2 id="assess-heading" className="sr-only">
            地址風險查詢
          </h2>
          <AssessApp />
        </section>

        <section
          aria-labelledby="scoring-heading"
          className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
        >
          <h2 id="scoring-heading" className="text-base font-semibold">
            評分對照表
          </h2>
          <ul className="grid grid-cols-5 gap-2 text-center text-xs">
            {RISK_LEVELS.map((l) => (
              <li
                key={l.label}
                className="rounded-md px-2 py-2 text-white"
                style={{ backgroundColor: l.color }}
              >
                <div className="font-semibold">{l.label}</div>
                <div className="opacity-90">{l.score}</div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">
            淹水分數依「24h 350/500/650mm 三種降雨情境下是否淹水及淹水深度」計算；地震分數為
            <code>0.6 × 斷層 + 0.4 × 液化</code>，無液化資料之縣市僅採用斷層子分數。
          </p>
        </section>

        <section aria-labelledby="faq-heading" className="space-y-3">
          <h2 id="faq-heading" className="text-base font-semibold">
            常見問題
          </h2>
          <dl className="space-y-3">
            {FAQS.map((f) => (
              <div
                key={f.q}
                className="rounded-lg border border-gray-200 bg-white p-3"
              >
                <dt className="text-sm font-semibold text-gray-800">{f.q}</dt>
                <dd className="mt-1 text-sm text-gray-600">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="api-heading"
          className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm"
        >
          <h2 id="api-heading" className="text-base font-semibold">
            給開發者與 AI Agent
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-gray-600">
            <li>
              REST API：<code>POST /v1/assess</code>（見
              <Link
                href="/openapi.json"
                className="underline hover:text-gray-800"
              >
                OpenAPI 3.1 規格
              </Link>
              ）
            </li>
            <li>
              AI 友善索引：
              <Link href="/llms.txt" className="underline hover:text-gray-800">
                /llms.txt
              </Link>
              ／
              <Link
                href="/llms-full.txt"
                className="underline hover:text-gray-800"
              >
                /llms-full.txt
              </Link>
            </li>
            <li>
              Agent plugin 描述：
              <Link
                href="/.well-known/ai-plugin.json"
                className="underline hover:text-gray-800"
              >
                /.well-known/ai-plugin.json
              </Link>
            </li>
            <li>
              GitHub：
              <Link
                href="https://github.com/Ryan-focus/residence-risk-tw"
                className="underline hover:text-gray-800"
              >
                Ryan-focus/residence-risk-tw
              </Link>
              （AGPL-3.0）
            </li>
          </ul>
        </section>
      </main>

      <Footer />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }}
      />
    </>
  );
}
