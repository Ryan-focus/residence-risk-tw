"use client";

import { useState } from "react";
import { FloodRisk } from "@/lib/types";

export default function RiskDetails({ risks }: { risks: FloodRisk[] }) {
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
        {open ? "收合" : "展開"}風險情境明細（{risks.length} 筆）
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
