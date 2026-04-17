"use client";

import { FloodAssessment } from "@/lib/types";

export default function ResultCard({ flood }: { flood: FloodAssessment }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
      <div
        className="px-4 py-3 text-white"
        style={{ backgroundColor: flood.color }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold">{flood.score}</span>
          <span className="text-lg font-medium">{flood.level}</span>
        </div>
        <div className="mt-1 text-sm opacity-90">淹水風險分數（0-100）</div>
      </div>
      <div className="bg-white px-4 py-3 text-xs text-gray-500">
        {flood.disclaimer}
      </div>
    </div>
  );
}
