"use client";

import L from "leaflet";
import { MapContainer, TileLayer, Marker, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icon in bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export default function MapView({
  lat,
  lng,
  color,
}: {
  lat: number;
  lng: number;
  color: string;
}) {
  return (
    <div className="h-[300px] w-full rounded-lg overflow-hidden border border-gray-200">
      <MapContainer
        center={[lat, lng]}
        zoom={15}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]} />
        <CircleMarker
          center={[lat, lng]}
          radius={40}
          pathOptions={{
            color,
            fillColor: color,
            fillOpacity: 0.2,
            weight: 2,
          }}
        />
      </MapContainer>
    </div>
  );
}
