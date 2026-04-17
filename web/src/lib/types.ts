export interface FloodRisk {
  scenario: string;
  duration_hours: number;
  rainfall_mm: number;
  depth_class: string;
  distance_m: number | null;
}

export interface FloodAssessment {
  score: number;
  level: string;
  color: string;
  risks: FloodRisk[];
  disclaimer: string;
}

export interface Location {
  lat: number;
  lng: number;
  source: "cache" | "nominatim" | "tgos";
  display_name: string;
}

export interface AssessResponse {
  address: string;
  location: Location;
  flood: FloodAssessment;
  meta: {
    response_ms: number;
    api_version: string;
  };
  disclaimer: string;
}

export interface ApiError {
  error: string;
  code: string;
  message: string;
}
