import { requestQortium } from './qortiumClient.js';

export interface UserAccount {
  address: string;
  avatarUrl?: string | null;
  isUnlocked?: boolean;
  publicKey?: string;
  name?: string | null;
}

interface AccountNameResponse {
  name?: string;
}

interface NameDataResponse {
  owner?: string;
  ownerAddress?: string;
  address?: string;
}

const ACCOUNT_NAMES_TTL_MS = 5 * 60 * 1000;
const NAME_ADDRESS_TTL_MS = 5 * 60 * 1000;

type CachedValue<T> = {
  value: T;
  cachedAt: number;
};

const accountNamesCache = new Map<string, CachedValue<string[]>>();
const accountNamesInflight = new Map<string, Promise<string[]>>();
const nameAddressCache = new Map<string, CachedValue<string | null>>();
const nameAddressInflight = new Map<string, Promise<string | null>>();

const isFresh = (cachedAt: number, ttlMs: number) => {
  return Date.now() - cachedAt < ttlMs;
};

const readNumericBalance = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === 'object' && value !== null) {
    const candidateRecord = value as Record<string, unknown>;
    const keys = ['value', 'balance', 'amount'];
    for (const key of keys) {
      const parsed = readNumericBalance(candidateRecord[key]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
};

const normalizeNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (typeof entry === 'object' && entry !== null) {
        const candidate = (entry as AccountNameResponse).name;
        return typeof candidate === 'string' ? candidate : null;
      }

      return null;
    })
    .filter((name): name is string => Boolean(name && name.trim()));
};

export const getUserAccount = async (): Promise<UserAccount> => {
  return requestQortium<UserAccount>({ action: 'GET_SELECTED_ACCOUNT' });
};

export const getAccountNames = async (address: string): Promise<string[]> => {
  const normalizedAddress = address.trim();
  if (!normalizedAddress) {
    return [];
  }

  const cached = accountNamesCache.get(normalizedAddress);
  if (cached && isFresh(cached.cachedAt, ACCOUNT_NAMES_TTL_MS)) {
    return cached.value;
  }

  const existingInflight = accountNamesInflight.get(normalizedAddress);
  if (existingInflight) {
    return existingInflight;
  }

  const requestPromise = requestQortium<unknown>({
    action: 'GET_ACCOUNT_NAMES',
    address: normalizedAddress,
  })
    .then((raw) => {
      const normalizedNames = normalizeNames(raw);
      accountNamesCache.set(normalizedAddress, {
        value: normalizedNames,
        cachedAt: Date.now(),
      });
      return normalizedNames;
    })
    .finally(() => {
      accountNamesInflight.delete(normalizedAddress);
    });

  accountNamesInflight.set(normalizedAddress, requestPromise);
  return requestPromise;
};

export const resolveNameWalletAddress = async (
  name: string
): Promise<string | null> => {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }

  const cacheKey = trimmedName.toLowerCase();
  const cached = nameAddressCache.get(cacheKey);
  if (cached && isFresh(cached.cachedAt, NAME_ADDRESS_TTL_MS)) {
    return cached.value;
  }

  const existingInflight = nameAddressInflight.get(cacheKey);
  if (existingInflight) {
    return existingInflight;
  }

  const requestPromise = requestQortium<NameDataResponse | null>({
    action: 'GET_NAME_DATA',
    name: trimmedName,
  })
    .then((response) => {
      if (!response || typeof response !== 'object') {
        nameAddressCache.set(cacheKey, {
          value: null,
          cachedAt: Date.now(),
        });
        return null;
      }

      const resolvedAddress =
        normalizeAddress(response.owner) ||
        normalizeAddress(response.ownerAddress) ||
        normalizeAddress(response.address);

      nameAddressCache.set(cacheKey, {
        value: resolvedAddress,
        cachedAt: Date.now(),
      });

      return resolvedAddress;
    })
    .finally(() => {
      nameAddressInflight.delete(cacheKey);
    });

  nameAddressInflight.set(cacheKey, requestPromise);
  return requestPromise;
};

export const clearWalletLookupCaches = () => {
  accountNamesCache.clear();
  accountNamesInflight.clear();
  nameAddressCache.clear();
  nameAddressInflight.clear();
};

export const getAccountNamesUncached = async (
  address: string
): Promise<string[]> => {
  const raw = await requestQortium<unknown>({
    action: 'GET_ACCOUNT_NAMES',
    address,
  });

  return normalizeNames(raw);
};

const normalizeAddress = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const getQortBalance = async (): Promise<number> => {
  try {
    const response = await requestQortium<unknown>({
      action: 'GET_BALANCE',
      coin: 'QORT',
    });
    const parsed = readNumericBalance(response);
    if (parsed !== null) {
      return parsed;
    }
  } catch {
    // Final fallback below includes explicit address.
  }

  const account = await getUserAccount();
  const responseWithAddress = await requestQortium<unknown>({
    action: 'GET_BALANCE',
    coin: 'QORT',
    address: account.address,
  });
  const parsedWithAddress = readNumericBalance(responseWithAddress);
  if (parsedWithAddress !== null) {
    return parsedWithAddress;
  }

  throw new Error('Unable to read QORT wallet balance.');
};
