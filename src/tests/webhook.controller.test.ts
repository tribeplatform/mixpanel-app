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

import { Logger } from '@tribeplatform/node-logger';
import WebhookController from '@/controllers/webhook.controller';

const subscription = (currentSettings: any[] = [{ context: 'NETWORK', settings: { apiKey: 'project-token', region: 'us' } }]) => ({
  type: 'SUBSCRIPTION',
  networkId: 'net-1',
  currentSettings,
  data: {
    shortDescription: 'Post published',
    time: '2026-10-23T10:00:00.000Z',
    actor: { id: 'member-1', roleType: 'member' },
    object: { id: 'post-1', networkId: 'net-1' },
  },
});

// Calls the handler like Express would and resolves with what it sent.
const call = (body: any): Promise<{ status: number; body: any }> =>
  new Promise((resolve, reject) => {
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };
    new WebhookController().index({ body } as any, res).catch(reject);
    setTimeout(() => reject(new Error('handler did not respond')), 2000);
  });

const engagePayload = () => {
  const call = mockAxiosGet.mock.calls.find(([url]) => url.endsWith('/engage'));
  return call && JSON.parse(call[1].params.data);
};

beforeEach(() => {
  mockAxiosGet.mockReset();
  mockMembersGet.mockReset();
});

describe('WebhookController', () => {
  it('answers FAILED when Mixpanel /track errors, instead of never responding', async () => {
    mockAxiosGet.mockRejectedValue(Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } }));

    const res = await call(subscription());

    expect(res).toEqual({ status: 200, body: { type: 'SUBSCRIPTION', status: 'FAILED', data: {} } });
  });

  it('still succeeds when the member lookup fails, and logs why', async () => {
    mockAxiosGet.mockResolvedValue({ data: { status: 1, error: null } });
    mockMembersGet.mockRejectedValue(Object.assign(new Error('Forbidden'), { response: { errors: [{ code: '403' }] } }));

    // Spy on the Logger itself: winston writes to stdout asynchronously, so capturing stdout is flaky.
    const logged: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((...args) => {
      logged.push(JSON.stringify(args));
    });

    const res = await call(subscription());
    spy.mockRestore();

    expect(res.body.status).toBe('SUCCEEDED');
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(logged.join('\n')).toContain('Cannot send user to Mixpanel');
    expect(logged.join('\n')).toContain('Forbidden');
    expect(logged.join('\n')).toContain('net-1');
  });

  it('asks only for the member fields it sends and maps lastSeenAt and role type', async () => {
    mockAxiosGet.mockResolvedValue({ data: { status: 1, error: null } });
    mockMembersGet.mockResolvedValue({
      id: 'member-1',
      name: 'Jane',
      email: 'jane@example.com',
      lastSeenAt: '2026-10-22T09:00:00.000Z',
      role: { type: 'admin' },
    });

    await call(subscription());

    expect(mockMembersGet).toHaveBeenCalledWith({ id: 'member-1' }, { role: 'basic' });
    expect(engagePayload()).toEqual({
      $distinct_id: 'member-1',
      token: 'project-token',
      $set: {
        'Member ID': 'member-1',
        'Role Type': 'admin',
        $email: 'jane@example.com',
        $name: 'Jane',
        $last_seen: '2026-10-22T09:00:00.000Z',
      },
    });
  });

  it('uses the NETWORK settings entry and does not overwrite other entries', async () => {
    mockAxiosGet.mockResolvedValue({ data: { status: 1, error: null } });
    mockMembersGet.mockResolvedValue({ id: 'member-1' });
    const spaceSettings = { context: 'SPACE', settings: { apiKey: 'space-token' } };
    const input = subscription([spaceSettings, { context: 'NETWORK', settings: { apiKey: 'network-token', region: 'eu' } }]);

    await call(input);

    const [url, options] = mockAxiosGet.mock.calls[0];
    expect(url).toBe('https://api-eu.mixpanel.com/track');
    expect(JSON.parse(options.params.data).properties.token).toBe('network-token');
    expect(spaceSettings.context).toBe('SPACE');
  });

  it('falls back to the first settings entry when none is marked NETWORK', async () => {
    mockAxiosGet.mockResolvedValue({ data: { status: 1, error: null } });
    mockMembersGet.mockResolvedValue({ id: 'member-1' });

    await call(subscription([{ settings: { apiKey: 'only-token', region: 'us' } }]));

    expect(JSON.parse(mockAxiosGet.mock.calls[0][1].params.data).properties.token).toBe('only-token');
  });
});
