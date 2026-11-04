jest.mock('@config', () => ({
  CLIENT_ID: 'test-client-id',
  CLIENT_SECRET: 'test-client-secret',
  GRAPHQL_URL: 'https://api.bettermode.test/graphql',
}));

const mockGetTribeClient = jest.fn();
jest.mock('@tribeplatform/gql-client', () => ({
  GlobalClient: jest.fn().mockImplementation(() => ({ getTribeClient: (...args) => mockGetTribeClient(...args) })),
}));

import { clearTribeClientCache, getTribeClient } from '@/utils/tribe_client';

const tokenExpiringIn = (ms: number) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor((Date.now() + ms) / 1000) })).toString('base64url');
  return `header.${payload}.signature`;
};
const clientWithToken = (token: string) => ({ client: { accessToken: token } });

describe('getTribeClient', () => {
  beforeEach(() => {
    clearTribeClientCache();
    mockGetTribeClient.mockReset();
    jest.restoreAllMocks();
  });

  it('requests one token per network and reuses it', async () => {
    // Arrange
    const client = clientWithToken(tokenExpiringIn(60 * 60 * 1000));
    mockGetTribeClient.mockResolvedValue(client);

    // Act
    const first = await getTribeClient({ networkId: 'net-1' });
    const second = await getTribeClient({ networkId: 'net-1' });

    // Assert
    expect(first).toBe(client);
    expect(second).toBe(client);
    expect(mockGetTribeClient).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request between concurrent webhooks', async () => {
    // Arrange
    mockGetTribeClient.mockResolvedValue(clientWithToken(tokenExpiringIn(60 * 60 * 1000)));

    // Act
    await Promise.all([getTribeClient({ networkId: 'net-1' }), getTribeClient({ networkId: 'net-1' })]);

    // Assert
    expect(mockGetTribeClient).toHaveBeenCalledTimes(1);
  });

  it('keeps networks apart', async () => {
    // Arrange
    mockGetTribeClient.mockImplementation(async ({ networkId }) => ({ networkId, ...clientWithToken(tokenExpiringIn(60 * 60 * 1000)) }));

    // Act
    const a = await getTribeClient({ networkId: 'net-1' });
    const b = await getTribeClient({ networkId: 'net-2' });

    // Assert
    expect(a).toMatchObject({ networkId: 'net-1' });
    expect(b).toMatchObject({ networkId: 'net-2' });
    expect(mockGetTribeClient).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed request', async () => {
    // Arrange
    mockGetTribeClient.mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce(clientWithToken(tokenExpiringIn(60 * 60 * 1000)));

    // Act
    await expect(getTribeClient({ networkId: 'net-1' })).rejects.toThrow('429');
    await getTribeClient({ networkId: 'net-1' });

    // Assert
    expect(mockGetTribeClient).toHaveBeenCalledTimes(2);
  });

  it('requests a new token 5 minutes before the cached one expires', async () => {
    // Arrange
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    mockGetTribeClient.mockResolvedValue(clientWithToken(tokenExpiringIn(10 * 60 * 1000)));
    await getTribeClient({ networkId: 'net-1' });

    // Act
    now.mockReturnValue(start + 4 * 60 * 1000);
    await getTribeClient({ networkId: 'net-1' });
    now.mockReturnValue(start + 6 * 60 * 1000);
    await getTribeClient({ networkId: 'net-1' });

    // Assert
    expect(mockGetTribeClient).toHaveBeenCalledTimes(2);
  });

  it('falls back to a 10 minute lifetime when the token has no readable expiry', async () => {
    // Arrange
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    mockGetTribeClient.mockResolvedValue(clientWithToken('not-a-jwt'));
    await getTribeClient({ networkId: 'net-1' });

    // Act
    now.mockReturnValue(start + 9 * 60 * 1000);
    await getTribeClient({ networkId: 'net-1' });
    now.mockReturnValue(start + 11 * 60 * 1000);
    await getTribeClient({ networkId: 'net-1' });

    // Assert
    expect(mockGetTribeClient).toHaveBeenCalledTimes(2);
  });
});
