"use client";

import { useState } from "react";
import {
  EarthquakeAssessment,
  EarthquakeHistory,
  FloodRisk,
} from "@/lib/types";

/** 把 **bold** 標記渲染為 <strong>（簡易 markdown 子集） */
function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-gray-900">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function ReasoningList({
  title,
  reasoning,
}: {
  title: string;
  reasoning: string[];
}) {
  if (!reasoning || reasoning.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700 leading-relaxed">
        {reasoning.map((line, i) => (
          <li key={i}>{renderBold(line)}</li>
        ))}
      </ul>
    </section>
  );
}

export function FloodDetails({ risks }: { risks: FloodRisk[] }) {
  const [open, setOpen] = useState(false);

  if (risks.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        查詢範圍內未發現淹水潛勢紀錄。
      </p>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-blue-600 hover:text-blue-800 underline"
      >
        {open ? "收合" : "展開"}淹水情境明細（{risks.length} 筆）
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">情境</th>
                <th className="px-3 py-2">時數</th>
                <th className="px-3 py-2">雨量 (mm)</th>
                <th className="px-3 py-2">淹水深度</th>
                <th className="px-3 py-2">距離</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {risks.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2">{r.scenario}</td>
                  <td className="px-3 py-2">{r.duration_hours}h</td>
                  <td className="px-3 py-2">{r.rainfall_mm}</td>
                  <td className="px-3 py-2">{r.depth_class}</td>
                  <td className="px-3 py-2">
                    {r.distance_m === null ? "區域內" : `${r.distance_m} m`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function EarthquakeDetails({
  earthquake,
}: {
  earthquake: EarthquakeAssessment;
}) {
  const [open, setOpen] = useState(false);
  const { fault, liquefaction } = earthquake;
  const totalCount = fault.risks.length + liquefaction.risks.length;

  if (totalCount === 0) {
    return (
      <p className="text-sm text-gray-500">
        查詢範圍內未發現活動斷層或液化潛勢紀錄
        {liquefaction.has_data ? "" : "（此縣市尚無液化資料）"}。
      </p>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-blue-600 hover:text-blue-800 underline"
      >
        {open ? "收合" : "展開"}地震情境明細（斷層 {fault.risks.length}／液化{" "}
        {liquefaction.risks.length}）
      </button>
      {open && (
        <div className="mt-2 space-y-3 overflow-x-auto">
          {fault.risks.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-gray-500">活動斷層敏感區</div>
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2">斷層</th>
                    <th className="px-3 py-2">類別</th>
                    <th className="px-3 py-2">距離</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {fault.risks.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2">{r.fault_name}</td>
                      <td className="px-3 py-2">第{r.fault_class}類</td>
                      <td className="px-3 py-2">
                        {r.distance_m === null ? "敏感區內" : `${r.distance_m} m`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {liquefaction.risks.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-gray-500">
                土壤液化潛勢
                {liquefaction.has_data ? "" : "（此縣市尚無資料）"}
              </div>
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2">潛勢等級</th>
                    <th className="px-3 py-2">距離</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {liquefaction.risks.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2">{r.level}</td>
                      <td className="px-3 py-2">
                        {r.distance_m === null ? "區域內" : `${r.distance_m} m`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 震度等級 → Tailwind 色；對應氣象署震度色票（簡化版） */
function intensityColor(level: string): string {
  const map: Record<string, string> = {
    "0": "bg-gray-200 text-gray-700",
    "1": "bg-gray-300 text-gray-800",
    "2": "bg-sky-200 text-sky-900",
    "3": "bg-teal-200 text-teal-900",
    "4": "bg-lime-300 text-lime-900",
    "5弱": "bg-yellow-400 text-yellow-900",
    "5強": "bg-amber-500 text-white",
    "6弱": "bg-orange-500 text-white",
    "6強": "bg-red-600 text-white",
    "7": "bg-red-800 text-white",
  };
  return map[level] ?? "bg-gray-300 text-gray-800";
}

function formatOriginTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function EarthquakeHistoryCard({
  history,
}: {
  history: EarthquakeHistory;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!history.available) {
    return (
      <section className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500">
        歷史地震資料尚未匯入（管理員可執行 <code>import_earthquake_history.py</code>）。
      </section>
    );
  }

  if (history.events.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
        過去 {history.years_back} 年內，震央 {history.radius_km} km 範圍內無顯著有感地震紀錄。
      </section>
    );
  }

  const visible = expanded ? history.events : history.events.slice(0, 3);

  return (
    <section className="space-y-2">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          近 {history.years_back} 年歷史有感地震（震央 {history.radius_km} km 內，共 {history.events.length} 次）
        </h3>
        {history.events.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-600 underline hover:text-blue-800"
          >
            {expanded ? "僅顯示前 3 筆" : `顯示全部 ${history.events.length} 筆`}
          </button>
        )}
      </header>

      <ul className="space-y-2">
        {visible.map((e) => {
          const intensity = e.estimated_intensity;
          return (
            <li
              key={e.earthquake_no}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900">
                    {formatOriginTime(e.origin_time)}　M{e.magnitude.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    震央：{e.location_description ?? "—"}
                    　·　距本地 {e.epicenter_distance_km} km
                    　·　深度 {e.depth_km} km
                  </div>
                </div>
                {intensity && (
                  <div
                    className={`flex-shrink-0 rounded-md px-2 py-1 text-xs font-bold leading-none whitespace-nowrap ${intensityColor(intensity.level)}`}
                    title={`最近測站 ${intensity.nearest_station.name} 距本地 ${intensity.nearest_station.distance_km} km 之實測`}
                  >
                    震度 {intensity.level}
                  </div>
                )}
              </div>

              {intensity ? (
                <div className="mt-2 text-xs text-gray-500">
                  推定方法：最近測站實測（{intensity.nearest_station.name}
                  {intensity.nearest_station.county ? `，${intensity.nearest_station.county}` : ""}
                  　距本地 {intensity.nearest_station.distance_km} km
                  {intensity.nearest_station.pga_gal !== null
                    ? `　PGA ${intensity.nearest_station.pga_gal.toFixed(1)} gal`
                    : ""}
                  ）
                </div>
              ) : (
                <div className="mt-2 text-xs text-gray-500">
                  最近 CWB 測站距本地 &gt; 15 km，未做震度推定。
                </div>
              )}

              {e.source_url && (
                <a
                  href={e.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs text-blue-600 underline hover:text-blue-800"
                >
                  CWB 報告 ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Backwards-compatible default export (淹水)
export default FloodDetails;
