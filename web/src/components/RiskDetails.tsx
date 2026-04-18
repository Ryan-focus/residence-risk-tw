"use client";

import { useState } from "react";
import { EarthquakeAssessment, FloodRisk } from "@/lib/types";

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

// Backwards-compatible default export (淹水)
export default FloodDetails;
