jest.mock('@config', () => ({
  CLIENT_ID: 'test-client-id',
  CLIENT_SECRET: 'test-client-secret',
  SIGNING_SECRET: 'test-signing-secret',
  GRAPHQL_URL: 'https://api.bettermode.test/graphql',
  LOG_FORMAT: 'info',
}));

const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { get: (...args) => mockAxiosGet(...args) } }));

const mockMembersGet = jest.fn();
jest.mock('@tribeplatform/gql-client', () => {
  const actual = jest.requireActual('@tribeplatform/gql-client');
  return {
    ...actual,
    GlobalClient: jest.fn().mockImplementation(() => ({
      getTribeClient: async () => ({ members: { get: mockMembersGet } }),
    })),
  };
});

import App from '@/app';
import HealthRoute from '@routes/health.route';
import IndexRoute from '@routes/index.route';
import { Logger } from '@tribeplatform/node-logger';
import MixpanelService from '@/services/mixpanel.service';
import WebhookRoute from '@/routes/webhook.route';
import request from 'supertest';
import { getSignature } from '@/utils/signature';

// DB_HOST is not set, so App does not try to connect to MongoDB. One app for the whole file,
// like in production (each App creates its route controllers and their loggers).
const server = new App({ client: [new IndexRoute(), new HealthRoute()], server: [new WebhookRoute()] }).getServer();
const buildServer = () => server;

const post = (server, body: string, headers: { timestamp?: number; signature?: string } = {}) => {
  const req = request(server).post('/api/webhook').set('Content-Type', 'application/json');
  if (headers.timestamp !== undefined) req.set('x-tribe-request-timestamp', String(headers.timestamp));
  if (headers.signature !== undefined) req.set('x-tribe-signature', headers.signature);
  return req.send(body);
};

const signedPost = (server, payload: object, options: { secret?: string; timestamp?: number } = {}) => {
  const body = JSON.stringify(payload);
  const timestamp = options.timestamp ?? Date.now();
  const signature = getSignature({ secret: options.secret ?? 'test-signing-secret', body, timestamp });
  return post(server, body, { timestamp, signature });
};

const subscription = (extra: object = {}) => ({
  type: 'SUBSCRIPTION',
  networkId: 'net-1',
  currentSettings: [{ context: 'NETWORK', settings: { apiKey: 'mixpanel-project-token', region: 'us' } }],
  data: {
    name: 'post.published',
    shortDescription: 'Post published',
    time: '2026-10-23T10:00:00.000Z',
    actor: { id: 'member-1', roleType: 'member' },
    object: { id: 'post-1', networkId: 'net-1', title: 'Hello' },
    ...extra,
  },
});

beforeEach(() => {
  mockAxiosGet.mockReset();
  mockMembersGet.mockReset();
});

describe('App', () => {
  it('[GET] /_health responds 200', async () => {
    const res = await request(buildServer()).get('/_health');

    expect(res.status).toBe(200);
  });

  it('[POST] /api/webhook rejects an unsigned request with 403', async () => {
    const res = await post(buildServer(), JSON.stringify({ type: 'TEST', data: { challenge: 'abc' } }));

    expect(res.status).toBe(403);
    expect(res.body).not.toEqual(expect.objectContaining({ status: 'SUCCEEDED' }));
  });

  it('[POST] /api/webhook rejects a request signed with the wrong secret with 403', async () => {
    const res = await signedPost(buildServer(), { type: 'TEST', data: { challenge: 'abc' } }, { secret: 'wrong-secret' });

    expect(res.status).toBe(403);
  });

  it('[POST] /api/webhook rejects a signature older than 5 minutes with 403', async () => {
    const res = await signedPost(buildServer(), { type: 'TEST', data: { challenge: 'abc' } }, { timestamp: Date.now() - 6 * 60 * 1000 });

    expect(res.status).toBe(403);
  });

  it('[POST] /api/webhook rejects a signature of the wrong length with 403, not 500', async () => {
    const body = JSON.stringify({ type: 'TEST', data: { challenge: 'abc' } });

    const res = await post(buildServer(), body, { timestamp: Date.now(), signature: 'short' });

    expect(res.status).toBe(403);
  });

  it('[POST] /api/webhook answers a signed TEST challenge', async () => {
    const res = await signedPost(buildServer(), { type: 'TEST', data: { challenge: 'abc' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'TEST', status: 'SUCCEEDED', data: { challenge: 'abc' } });
  });

  it('[POST] /api/webhook accepts a signed 300kb webhook (over the old 100kb limit)', async () => {
    const payload = subscription({ object: { id: 'post-1', networkId: 'net-1', title: 'x'.repeat(300 * 1024) } });
    mockAxiosGet.mockResolvedValue({ data: { status: 1, error: null } });
    mockMembersGet.mockResolvedValue({ id: 'member-1', name: 'Jane', email: 'jane@example.com' });

    const res = await signedPost(buildServer(), payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCEEDED');
  });

  it('[POST] /api/webhook answers a body over the 2mb limit with 413', async () => {
    const payload = subscription({ object: { id: 'post-1', title: 'x'.repeat(3 * 1024 * 1024) } });

    const res = await signedPost(buildServer(), payload);

    expect(res.status).toBe(413);
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('[POST] /api/webhook sends a signed SUBSCRIPTION to Mixpanel /track and /engage', async () => {
    mockAxiosGet.mockResolvedValue({ data: { status: 1, error: null } });
    mockMembersGet.mockResolvedValue({ id: 'member-1', name: 'Jane', email: 'jane@example.com' });

    const res = await signedPost(buildServer(), subscription());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'SUBSCRIPTION', status: 'SUCCEEDED', data: { status: 1, error: null } });
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    const [trackUrl, trackOptions] = mockAxiosGet.mock.calls[0];
    expect(trackUrl).toBe('https://api.mixpanel.com/track');
    const event = JSON.parse(trackOptions.params.data);
    expect(event).toEqual(
      expect.objectContaining({
        event: 'Post published',
        properties: expect.objectContaining({ token: 'mixpanel-project-token', distinct_id: 'member-1', ID: 'post-1' }),
      }),
    );
    const [engageUrl, engageOptions] = mockAxiosGet.mock.calls[1];
    expect(engageUrl).toBe('https://api.mixpanel.com/engage');
    expect(JSON.parse(engageOptions.params.data)).toEqual(
      expect.objectContaining({
        $distinct_id: 'member-1',
        token: 'mixpanel-project-token',
        $set: expect.objectContaining({ $email: 'jane@example.com' }),
      }),
    );
  });
});

describe('MixpanelService', () => {
  it('does not add a process listener per instance', () => {
    const before = process.listenerCount('uncaughtException');

    for (let i = 0; i < 20; i++) new MixpanelService('token', 'us');

    expect(process.listenerCount('uncaughtException')).toBe(before);
  });

  it('does not log the project token or member PII', async () => {
    // Spy on the Logger itself: winston writes to stdout asynchronously, so capturing stdout is flaky.
    const logged: string[] = [];
    const record = (...args) => {
      logged.push(JSON.stringify(args));
    };
    const spies = ['log', 'error', 'warn', 'debug'].map(level => jest.spyOn(Logger.prototype, level as any).mockImplementation(record));
    mockAxiosGet.mockResolvedValue({ data: { status: 1 } });
    const client = new MixpanelService('secret-project-token', 'eu');

    await client.track({ event: 'Post published', properties: { distinct_id: 'member-1' } });
    await client.setUserProperties({ $distinct_id: 'member-1', $set: { $email: 'jane@example.com', $name: 'Jane' } });
    spies.forEach(spy => spy.mockRestore());

    expect(mockAxiosGet.mock.calls[0][0]).toBe('https://api-eu.mixpanel.com/track');
    expect(logged.join('\n')).toContain('Send data to Mixpanel');
    expect(logged.join('\n')).not.toContain('secret-project-token');
    expect(logged.join('\n')).not.toContain('jane@example.com');
  });
});
