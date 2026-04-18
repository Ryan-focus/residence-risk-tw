/**
 * OpenAPI 3.1 spec for Residence Risk TW API.
 *
 * Served at GET /v1/openapi.json — also mirrored as a static asset at
 * the Pages deployment (public/openapi.json) for offline agent discovery.
 */

export const API_VERSION = '0.2.0';

export function buildOpenApiSpec(requestUrl: URL): unknown {
	const serverUrl = `${requestUrl.protocol}//${requestUrl.host}`;

	return {
		openapi: '3.1.0',
		info: {
			title: 'Residence Risk TW API',
			version: API_VERSION,
			summary: '輸入台灣地址，回傳淹水與地震風險評分。',
			description:
				'整合台灣政府公開資料（淹水潛勢、活動斷層、土壤液化）的免費 REST API。僅供防災參考，不得作為不動產交易或保險決策依據。',
			contact: {
				name: 'Residence Risk TW',
				url: 'https://github.com/Ryan-focus/residence-risk-tw',
			},
			license: {
				name: 'AGPL-3.0-or-later',
				url: 'https://www.gnu.org/licenses/agpl-3.0.html',
			},
		},
		servers: [{ url: serverUrl, description: 'Current server' }],
		tags: [
			{ name: 'assessment', description: '住址風險評估' },
			{ name: 'meta', description: '後設資料與健康檢查' },
		],
		paths: {
			'/v1/health': {
				get: {
					tags: ['meta'],
					operationId: 'getHealth',
					summary: '健康檢查',
					responses: {
						'200': { description: '正常', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } } },
						'503': { description: '資料庫斷線', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } } },
					},
				},
			},
			'/v1/meta/versions': {
				get: {
					tags: ['meta'],
					operationId: 'getDataVersions',
					summary: '取得已匯入資料源版本',
					responses: {
						'200': {
							description: 'OK',
							content: { 'application/json': { schema: { $ref: '#/components/schemas/VersionsResponse' } } },
						},
					},
				},
			},
			'/v1/openapi.json': {
				get: {
					tags: ['meta'],
					operationId: 'getOpenApiSpec',
					summary: '取得本 API 的 OpenAPI 3.1 規格',
					responses: {
						'200': { description: 'OpenAPI document', content: { 'application/json': {} } },
					},
				},
			},
			'/v1/assess': {
				post: {
					tags: ['assessment'],
					operationId: 'assessAddress',
					summary: '評估台灣地址的淹水與地震風險',
					description:
						'輸入繁體中文地址，回傳 0-100 分五級風險評估，包含淹水（24h 350/500/650mm 情境）與地震（活動斷層、土壤液化）。',
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/AssessRequest' },
								examples: {
									taipei: { summary: '台北地址', value: { address: '台北市信義區信義路五段7號' } },
									taichung: { summary: '台中地址', value: { address: '台中市西區臺灣大道二段2號' } },
								},
							},
						},
					},
					responses: {
						'200': { description: '風險評估成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/AssessResponse' } } } },
						'400': { description: '請求格式錯誤', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
						'404': { description: '地址無法地理編碼', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
						'413': { description: '請求內容過大', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
						'500': { description: '伺服器內部錯誤', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
					},
				},
			},
		},
		components: {
			schemas: {
				AssessRequest: {
					type: 'object',
					required: ['address'],
					properties: {
						address: {
							type: 'string',
							maxLength: 200,
							description: '繁體中文台灣地址（含縣市、區、路、號）',
							examples: ['台北市信義區信義路五段7號'],
						},
					},
				},
				AssessResponse: {
					type: 'object',
					required: ['address', 'location', 'flood', 'earthquake', 'meta', 'disclaimer'],
					properties: {
						address: { type: 'string' },
						location: { $ref: '#/components/schemas/Location' },
						flood: { $ref: '#/components/schemas/FloodAssessment' },
						earthquake: { $ref: '#/components/schemas/EarthquakeAssessment' },
						meta: {
							type: 'object',
							properties: {
								response_ms: { type: 'integer', minimum: 0 },
								api_version: { type: 'string' },
							},
						},
						disclaimer: { type: 'string' },
					},
				},
				Location: {
					type: 'object',
					required: ['lat', 'lng', 'source', 'display_name'],
					properties: {
						lat: { type: 'number', format: 'double', minimum: -90, maximum: 90 },
						lng: { type: 'number', format: 'double', minimum: -180, maximum: 180 },
						source: { type: 'string', enum: ['cache', 'map8', 'nominatim'] },
						display_name: { type: 'string' },
					},
				},
				FloodAssessment: {
					type: 'object',
					required: ['score', 'level', 'color', 'risks', 'reasoning', 'disclaimer'],
					properties: {
						score: { type: 'integer', minimum: 0, maximum: 100 },
						level: { type: 'string', enum: ['極低', '低', '中', '高', '極高'] },
						color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
						risks: { type: 'array', items: { $ref: '#/components/schemas/FloodRisk' } },
						reasoning: {
							type: 'array',
							items: { type: 'string' },
							description: '自然語言判定依據 — 解釋此分數是由哪些降雨情境、淹水深度、地勢條件推得。',
						},
						disclaimer: { type: 'string' },
					},
				},
				FloodRisk: {
					type: 'object',
					properties: {
						scenario: { type: 'string', examples: ['24h_350mm'] },
						duration_hours: { type: 'integer' },
						rainfall_mm: { type: 'integer' },
						depth_class: { type: 'string', examples: ['0-50cm', '>50cm'] },
						distance_m: { type: ['integer', 'null'], description: '距離該淹水區的公尺；null 表示點位於區域內' },
					},
				},
				EarthquakeAssessment: {
					type: 'object',
					required: ['score', 'level', 'color', 'fault', 'liquefaction', 'history', 'reasoning', 'disclaimer'],
					properties: {
						score: { type: 'integer', minimum: 0, maximum: 100 },
						level: { type: 'string', enum: ['極低', '低', '中', '高', '極高'] },
						color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
						fault: {
							type: 'object',
							properties: {
								score: { type: 'integer' },
								risks: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											fault_name: { type: 'string' },
											fault_class: { type: 'integer', enum: [1, 2] },
											distance_m: { type: ['integer', 'null'] },
										},
									},
								},
							},
						},
						liquefaction: {
							type: 'object',
							properties: {
								score: { type: 'integer' },
								has_data: { type: 'boolean' },
								risks: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											level: { type: 'string', enum: ['高', '中', '低'] },
											distance_m: { type: ['integer', 'null'] },
										},
									},
								},
							},
						},
						history: { $ref: '#/components/schemas/EarthquakeHistory' },
						reasoning: {
							type: 'array',
							items: { type: 'string' },
							description: '自然語言判定依據 — 解釋此分數是由斷層、液化、歷史地震佐證等哪些因素推得。',
						},
						disclaimer: { type: 'string' },
					},
				},
				EarthquakeHistory: {
					type: 'object',
					required: ['available', 'radius_km', 'years_back', 'events'],
					properties: {
						available: {
							type: 'boolean',
							description: '是否已匯入歷史地震資料。false = 管理員尚未執行 import_earthquake_history.py。',
						},
						radius_km: { type: 'integer', description: '搜尋半徑（震央到查詢點）' },
						years_back: { type: 'integer', description: '回溯年數' },
						events: {
							type: 'array',
							items: { $ref: '#/components/schemas/EarthquakeHistoryEvent' },
						},
					},
				},
				EarthquakeHistoryEvent: {
					type: 'object',
					properties: {
						earthquake_no: { type: 'string', description: 'CWB 地震編號' },
						origin_time: { type: 'string', format: 'date-time' },
						magnitude: { type: 'number', description: '芮氏規模 ML' },
						depth_km: { type: 'number' },
						epicenter_lat: { type: 'number' },
						epicenter_lng: { type: 'number' },
						epicenter_distance_km: { type: 'number', description: '震央距查詢點的大圓距離' },
						location_description: { type: ['string', 'null'] },
						source_url: { type: ['string', 'null'], format: 'uri' },
						estimated_intensity: {
							oneOf: [
								{ type: 'null' },
								{
									type: 'object',
									required: ['level', 'method', 'nearest_station'],
									properties: {
										level: { type: 'string', description: "CWB 震度等級：'0'..'4','5弱','5強','6弱','6強','7'" },
										method: { type: 'string', enum: ['nearest_station'] },
										nearest_station: {
											type: 'object',
											properties: {
												name: { type: 'string' },
												county: { type: ['string', 'null'] },
												distance_km: { type: 'number' },
												pga_gal: { type: ['number', 'null'] },
											},
										},
									},
								},
							],
						},
					},
				},
				HealthResponse: {
					type: 'object',
					properties: {
						status: { type: 'string', enum: ['ok', 'degraded'] },
						database: { type: 'string', enum: ['connected', 'error'] },
						timestamp: { type: 'string', format: 'date-time' },
					},
				},
				VersionsResponse: {
					type: 'object',
					properties: {
						data_sources: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									dataset_name: { type: 'string' },
									source_org: { type: 'string' },
									data_version: { type: 'string' },
									imported_at: { type: 'string', format: 'date-time' },
									record_count: { type: 'integer' },
									attribution_text: { type: 'string' },
								},
							},
						},
						total: { type: 'integer' },
					},
				},
				ErrorResponse: {
					type: 'object',
					required: ['error', 'code', 'message'],
					properties: {
						error: { type: 'string' },
						code: {
							type: 'string',
							enum: ['INVALID_ADDRESS', 'INVALID_REQUEST', 'ADDRESS_NOT_FOUND', 'PAYLOAD_TOO_LARGE', 'INTERNAL_ERROR', 'NOT_FOUND'],
						},
						message: { type: 'string' },
					},
				},
			},
		},
	};
}
