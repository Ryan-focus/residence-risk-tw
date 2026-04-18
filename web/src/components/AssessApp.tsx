"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useAssess } from "@/hooks/useAssess";
import ConsentModal from "@/components/ConsentModal";
import AddressSearch from "@/components/AddressSearch";
import ResultCard from "@/components/ResultCard";
import { FloodDetails, EarthquakeDetails } from "@/components/RiskDetails";
import ResponseMeta from "@/components/ResponseMeta";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="h-[300px] w-full animate-pulse rounded-lg bg-gray-100" />
  ),
});

export default function AssessApp() {
  const [consented, setConsented] = useState(false);
  const { data, loading, error, assess } = useAssess();

  return (
    <>
      {!consented && <ConsentModal onConsent={() => setConsented(true)} />}

      <AddressSearch onSearch={assess} loading={loading} />

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
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
    </>
  );
}
