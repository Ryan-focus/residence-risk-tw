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

export interface FaultRisk {
  fault_name: string;
  fault_class: 1 | 2;
  distance_m: number | null;
}

export interface LiquefactionRisk {
  level: "高" | "中" | "低";
  distance_m: number | null;
}

export interface EarthquakeAssessment {
  score: number;
  level: string;
  color: string;
  fault: {
    score: number;
    risks: FaultRisk[];
  };
  liquefaction: {
    score: number;
    has_data: boolean;
    risks: LiquefactionRisk[];
  };
  disclaimer: string;
}

export interface Location {
  lat: number;
  lng: number;
  source: "cache" | "map8" | "nominatim";
  display_name: string;
}

export interface AssessResponse {
  address: string;
  location: Location;
  flood: FloodAssessment;
  earthquake: EarthquakeAssessment;
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
