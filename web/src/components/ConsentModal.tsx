"use client";

export default function ConsentModal({
  onConsent,
}: {
  onConsent: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-3 text-lg font-bold text-gray-900">使用須知</h2>
        <div className="mb-4 space-y-2 text-sm text-gray-600">
          <p>
            本工具使用政府公開淹水潛勢圖資，透過地理編碼將您輸入的地址轉換為座標後進行風險評估。
          </p>
          <p>
            評估結果<strong>僅供防災參考</strong>
            ，不構成任何土地使用、不動產交易或保險核保之決策依據。
          </p>
          <p>
            您的地址將傳送至伺服器進行查詢，但不會儲存原始地址。詳見隱私政策。
          </p>
        </div>
        <button
          onClick={onConsent}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          我了解，開始使用
        </button>
      </div>
    </div>
  );
}
