"use client";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-gray-200 bg-gray-50 px-4 py-4 text-center text-xs text-gray-500">
      <p>
        淹水潛勢資料來源：
        <a
          href="https://data.gov.tw/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-700"
        >
          政府資料開放平台
        </a>
        {" / "}
        地圖：
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-700"
        >
          OpenStreetMap
        </a>
        {" / "}
        地理編碼：
        <a
          href="https://nominatim.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-700"
        >
          Nominatim
        </a>
      </p>
    </footer>
  );
}
