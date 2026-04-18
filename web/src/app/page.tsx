"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useAssess } from "@/hooks/useAssess";
import ConsentModal from "@/components/ConsentModal";
import DisclaimerBanner from "@/components/DisclaimerBanner";
import AddressSearch from "@/components/AddressSearch";
import ResultCard from "@/components/ResultCard";
import { FloodDetails, EarthquakeDetails } from "@/components/RiskDetails";
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
            <div className="grid gap-3 sm:grid-cols-2">
              <ResultCard
                title="淹水風險分數"
                score={data.flood.score}
                level={data.flood.level}
                color={data.flood.color}
                disclaimer={data.flood.disclaimer}
              />
              <ResultCard
                title="地震風險分數"
                score={data.earthquake.score}
                level={data.earthquake.level}
                color={data.earthquake.color}
                disclaimer={data.earthquake.disclaimer}
              />
            </div>

            {data.location && (
              <MapView
                key={`${data.location.lat}-${data.location.lng}`}
                lat={data.location.lat}
                lng={data.location.lng}
                color={data.flood.color}
              />
            )}

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">淹水細節</h2>
              <FloodDetails risks={data.flood.risks} />
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">地震細節</h2>
              <EarthquakeDetails earthquake={data.earthquake} />
            </section>

            <ResponseMeta data={data} />
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
