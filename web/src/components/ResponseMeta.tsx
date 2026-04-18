"use client";

import { AssessResponse } from "@/lib/types";

const SOURCE_LABELS: Record<string, string> = {
  cache: "快取",
  map8: "圖霸 Map8",
  nominatim: "Nominatim",
};

export default function ResponseMeta({ data }: { data: AssessResponse }) {
  return (
    <div className="text-xs text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
      <span>回應時間：{data.meta.response_ms} ms</span>
      <span>
        座標：{data.location.lat.toFixed(5)}, {data.location.lng.toFixed(5)}
      </span>
      <span>
        編碼來源：{SOURCE_LABELS[data.location.source] ?? data.location.source}
      </span>
    </div>
  );
}
