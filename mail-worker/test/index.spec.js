import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

const expectCloudMailHtml = async (response) => {
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toContain('text/html');
	expect(await response.text()).toContain('<title>Cloud Mail</title>');
};

describe('Cloud Mail worker', () => {
	it('serves the frontend through the exported worker', async () => {
		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);

		await waitOnExecutionContext(ctx);
		await expectCloudMailHtml(response);
	});

	it('serves the frontend through the integration worker', async () => {
		await expectCloudMailHtml(await SELF.fetch('http://example.com/'));
	});
});
