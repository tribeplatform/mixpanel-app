import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL } from '@config';
import { GlobalClient, TribeClient } from '@tribeplatform/gql-client';

// Bettermode allows 1,000 app-token requests per network per app every 5 minutes. Every webhook used to
// request a new token for the member lookup, so a burst of events on one network hit that limit
// ("You've made too many request, please try again in 5 minutes.") and member profiles stopped syncing.
// The client, and with it the token, is cached per network until shortly before the token expires.
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_CLIENT_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { value: Promise<TribeClient>; expiresAt: number };

const clientCache = new Map<string, CacheEntry>();

export const clearTribeClientCache = () => clientCache.clear();

// Reads `exp` from the app token without verifying it; the token comes straight from Bettermode.
const tokenExpiresAt = (token: string): number | undefined => {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch (error) {
    return undefined;
  }
};

const clientExpiresAt = (client: TribeClient): number => {
  // TribeClient keeps the app token on its (private) GraphqlClient.
  const token: string = (client as any)?.client?.accessToken || (client as any)?.accessToken || '';
  const exp = token ? tokenExpiresAt(token) : undefined;
  if (exp) return exp - TOKEN_EXPIRY_MARGIN_MS;
  return Date.now() + DEFAULT_CLIENT_TTL_MS;
};

export const getTribeClient = ({ networkId }: { networkId: string }): Promise<TribeClient> => {
  const entry = clientCache.get(networkId);
  if (entry && entry.expiresAt > Date.now()) return entry.value;

  const value = new GlobalClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    graphqlUrl: GRAPHQL_URL,
  }).getTribeClient({ networkId });
  // Concurrent webhooks for the same network share one in-flight request.
  const newEntry: CacheEntry = { value, expiresAt: Number.MAX_SAFE_INTEGER };
  clientCache.set(networkId, newEntry);
  value.then(
    client => {
      newEntry.expiresAt = clientExpiresAt(client);
    },
    () => {
      // Never cache failures (e.g. a 429): the next webhook tries again.
      if (clientCache.get(networkId) === newEntry) clientCache.delete(networkId);
    },
  );
  return value;
};
