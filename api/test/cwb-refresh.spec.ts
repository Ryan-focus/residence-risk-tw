import { env } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseOriginTime, iterEvents, iterStations, refreshCwbEarthquakeHistory } from '../src/cwb-refresh';

// ── parseOriginTime ──────────────────────────────────────────────────────────

describe('parseOriginTime', () => {
	it('converts CWB YYYY-MM-DD HH:MM:SS (UTC+8) to ISO UTC', () => {
		const result = parseOriginTime('2026-04-01 10:00:00');
		expect(result).toBe('2026-04-01T02:00:00.000Z');
	});

	it('handles slash-separated date', () => {
		const result = parseOriginTime('2026/04/01 10:00:00');
		expect(result).toBe('2026-04-01T02:00:00.000Z');
	});

	it('returns null for null input', () => {
		expect(parseOriginTime(null)).toBeNull();
	});

	it('returns null for undefined input', () => {
		expect(parseOriginTime(undefined)).toBeNull();
	});

	it('returns original string for unparseable input', () => {
		expect(parseOriginTime('not-a-date')).toBe('not-a-date');
	});
});

// ── iterEvents ───────────────────────────────────────────────────────────────

const SAMPLE_EVENT = {
	EarthquakeNo: 11401,
	EarthquakeInfo: {
		OriginTime: '2026-04-01 10:00:00',
		FocalDepth: 10.5,
		Epicenter: { EpicenterLatitude: 23.5, EpicenterLongitude: 121.0, Location: '台灣附近' },
		EarthquakeMagnitude: { MagnitudeValue: 5.2 },
	},
	Intensity: {
		ShakingArea: [
			{
				AreaIntensity: '4',
				EqStation: [
					{ StationName: '台北', StationLatitude: 25.04, StationLongitude: 121.51, StationCounty: '台北市', SeismicIntensity: '4' },
				],
			},
		],
	},
	Web: 'https://example.com/eq/11401',
};

describe('iterEvents', () => {
	it('extracts events from records.Earthquake array', () => {
		const resp = { records: { Earthquake: [SAMPLE_EVENT] } };
		const events = iterEvents(resp);
		expect(events).toHaveLength(1);
	});

	it('handles lowercase records.earthquake key', () => {
		const resp = { records: { earthquake: [SAMPLE_EVENT] } };
		expect(iterEvents(resp)).toHaveLength(1);
	});

	it('returns empty array for empty response', () => {
		expect(iterEvents({})).toHaveLength(0);
		expect(iterEvents(null)).toHaveLength(0);
	});

	it('wraps single event object in array', () => {
		const resp = { records: { Earthquake: SAMPLE_EVENT } };
		expect(iterEvents(resp)).toHaveLength(1);
	});
});

// ── iterStations ─────────────────────────────────────────────────────────────

describe('iterStations', () => {
	it('extracts stations from Intensity.ShakingArea', () => {
		const stations = iterStations(SAMPLE_EVENT as Record<string, unknown>);
		expect(stations).toHaveLength(1);
		expect(stations[0].stationName).toBe('台北');
		expect(stations[0].lat).toBe(25.04);
		expect(stations[0].intensityLevel).toBe('4');
	});

	it('falls back to AreaDesc for intensity level', () => {
		const event = {
			Intensity: {
				ShakingArea: [
					{
						AreaDesc: '最大震度 5 強地區',
						EqStation: [{ StationName: '測站A', StationLatitude: 25.0, StationLongitude: 121.0 }],
					},
				],
			},
		};
		const stations = iterStations(event);
		expect(stations[0].intensityLevel).toBe('5 強');
	});

	it('returns empty array for event with no intensity data', () => {
		expect(iterStations({ EarthquakeNo: 1 })).toHaveLength(0);
	});

	it('returns entries for all stations including those with null name (filtering is caller responsibility)', () => {
		const event = {
			Intensity: {
				ShakingArea: [
					{
						AreaIntensity: '3',
						EqStation: [
							{ StationLatitude: 25.0, StationLongitude: 121.0 }, // no name → stationName = null
							{ StationName: '有名', StationLatitude: 25.1, StationLongitude: 121.1 },
						],
					},
				],
			},
		};
		const stations = iterStations(event);
		expect(stations).toHaveLength(2);
		expect(stations[0].stationName).toBeNull();
		expect(stations[1].stationName).toBe('有名');
	});
});

// ── refreshCwbEarthquakeHistory (integration) ────────────────────────────────

describe('refreshCwbEarthquakeHistory', () => {
	beforeEach(async () => {
		await env.DB.batch([
			env.DB.prepare('DELETE FROM rrw_earthquake_history'),
			env.DB.prepare('DELETE FROM rrw_earthquake_intensity'),
		]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const MOCK_CWB_RESPONSE = {
		success: 'true',
		records: {
			Earthquake: [SAMPLE_EVENT],
		},
	};

	it('upserts earthquake history and intensity records into D1', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => MOCK_CWB_RESPONSE,
		}));

		const result = await refreshCwbEarthquakeHistory(env.DB, 'TEST-KEY');
		expect(result.upserted).toBe(1);
		expect(result.skipped).toBe(0);

		const row = await env.DB
			.prepare('SELECT earthquake_no, magnitude FROM rrw_earthquake_history WHERE earthquake_no = ?')
			.bind('11401')
			.first<{ earthquake_no: string; magnitude: number }>();
		expect(row).not.toBeNull();
		expect(row!.magnitude).toBe(5.2);

		const intensity = await env.DB
			.prepare('SELECT COUNT(*) as cnt FROM rrw_earthquake_intensity WHERE earthquake_no = ?')
			.bind('11401')
			.first<{ cnt: number }>();
		expect(intensity!.cnt).toBe(1);
	});

	it('throws on CWB API non-OK response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }));
		await expect(refreshCwbEarthquakeHistory(env.DB, 'BAD-KEY')).rejects.toThrow('403');
	});

	it('skips events with missing required fields', async () => {
		const incompleteEvent = { EarthquakeNo: 99999 }; // missing OriginTime, lat, lng, magnitude
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ records: { Earthquake: [incompleteEvent] } }),
		}));
		const result = await refreshCwbEarthquakeHistory(env.DB, 'TEST-KEY');
		expect(result.skipped).toBe(1);
		expect(result.upserted).toBe(0);
	});

	it('replaces existing intensity data on re-import', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => MOCK_CWB_RESPONSE,
		}));
		// First import
		await refreshCwbEarthquakeHistory(env.DB, 'TEST-KEY');
		// Second import — intensity should not double
		await refreshCwbEarthquakeHistory(env.DB, 'TEST-KEY');

		const intensity = await env.DB
			.prepare('SELECT COUNT(*) as cnt FROM rrw_earthquake_intensity WHERE earthquake_no = ?')
			.bind('11401')
			.first<{ cnt: number }>();
		expect(intensity!.cnt).toBe(1); // not 2
	});
});
