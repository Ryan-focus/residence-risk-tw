import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Residence Risk API', () => {
	describe('GET /', () => {
		it('returns API info', async () => {
			const request = new IncomingRequest('http://example.com/');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			const body = await response.json<{ name: string; version: string }>();
			expect(body.name).toBe('Residence Risk TW API');
			expect(body.version).toBeDefined();
		});
	});

	describe('GET /v1/health', () => {
		it('returns health status with database check', async () => {
			const response = await SELF.fetch('https://example.com/v1/health');
			const body = await response.json<{ status: string; database: string }>();
			expect(response.status).toBe(200);
			expect(body.status).toBe('ok');
			expect(body.database).toBe('connected');
		});
	});

	describe('GET /v1/meta/versions', () => {
		it('returns data source versions (empty initially)', async () => {
			const response = await SELF.fetch('https://example.com/v1/meta/versions');
			const body = await response.json<{ data_sources: unknown[]; total: number }>();
			expect(response.status).toBe(200);
			expect(body.data_sources).toEqual([]);
			expect(body.total).toBe(0);
		});
	});

	describe('POST /v1/assess', () => {
		it('returns stub response for valid address', async () => {
			const response = await SELF.fetch('https://example.com/v1/assess', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: '台北市信義區信義路五段7號' }),
			});
			const body = await response.json<{ input: { address: string } }>();
			expect(response.status).toBe(200);
			expect(body.input.address).toBe('台北市信義區信義路五段7號');
		});

		it('returns 400 for missing address', async () => {
			const response = await SELF.fetch('https://example.com/v1/assess', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			expect(response.status).toBe(400);
		});

		it('returns 400 for invalid JSON', async () => {
			const response = await SELF.fetch('https://example.com/v1/assess', {
				method: 'POST',
				body: 'not json',
			});
			expect(response.status).toBe(400);
		});
	});

	describe('GET /v1/assess/:id', () => {
		it('returns 404 for non-existent report', async () => {
			const response = await SELF.fetch('https://example.com/v1/assess/nonexistent123');
			const body = await response.json<{ code: string }>();
			expect(response.status).toBe(404);
			expect(body.code).toBe('REPORT_NOT_FOUND');
		});
	});

	describe('404 handling', () => {
		it('returns 404 for unknown routes', async () => {
			const response = await SELF.fetch('https://example.com/unknown');
			expect(response.status).toBe(404);
		});
	});
});
