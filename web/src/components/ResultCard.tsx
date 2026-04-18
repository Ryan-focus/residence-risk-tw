"use client";

interface RiskCardProps {
  title: string;
  score: number;
  level: string;
  color: string;
  disclaimer: string;
}

export default function ResultCard({
  title,
  score,
  level,
  color,
  disclaimer,
}: RiskCardProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
      <div className="px-4 py-3 text-white" style={{ backgroundColor: color }}>
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold">{score}</span>
          <span className="text-lg font-medium">{level}</span>
        </div>
        <div className="mt-1 text-sm opacity-90">{title}（0-100）</div>
      </div>
      <div className="bg-white px-4 py-3 text-xs text-gray-500">
        {disclaimer}
      </div>
    </div>
  );
}
