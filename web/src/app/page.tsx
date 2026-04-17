"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useAssess } from "@/hooks/useAssess";
import ConsentModal from "@/components/ConsentModal";
import DisclaimerBanner from "@/components/DisclaimerBanner";
import AddressSearch from "@/components/AddressSearch";
import ResultCard from "@/components/ResultCard";
import RiskDetails from "@/components/RiskDetails";
import ResponseMeta from "@/components/ResponseMeta";
import Footer from "@/components/Footer";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function Home() {
  const [consented, setConsented] = useState(false);
  const { data, loading, error, assess } = useAssess();

  return (
    <>
      {!consented && <ConsentModal onConsent={() => setConsented(true)} />}
      <DisclaimerBanner />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 space-y-5">
        <h1 className="text-xl font-bold">住址風險評估</h1>

        <AddressSearch onSearch={assess} loading={loading} />

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {data && (
          <>
            <ResultCard flood={data.flood} />

            {data.location && (
              <MapView
                key={`${data.location.lat}-${data.location.lng}`}
                lat={data.location.lat}
                lng={data.location.lng}
                color={data.flood.color}
              />
            )}

            <RiskDetails risks={data.flood.risks} />
            <ResponseMeta data={data} />
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
