import { requestQortium } from './qortiumClient';

export const FORUM_FOLLOW_NAME = 'Discussion_Boards';
export const FOLLOWED_NAMES_LIST = 'followedNames';

const normalizeName = (value: string) => value.trim().toLowerCase();

const parseListItems = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
};

export const getFollowedNames = async () => {
  const response = await requestQortium<unknown>({
    action: 'GET_LIST',
    listName: FOLLOWED_NAMES_LIST,
  });

  return parseListItems(response);
};

export const isNameFollowed = async (name: string) => {
  const followedNames = await getFollowedNames();
  const normalizedTarget = normalizeName(name);
  return followedNames.some(
    (followedName) => normalizeName(followedName) === normalizedTarget
  );
};

export const followName = async (name: string) => {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error('Follow name is missing.');
  }

  const alreadyFollowed = await isNameFollowed(normalized);
  if (alreadyFollowed) {
    return { alreadyFollowed: true };
  }

  await requestQortium<unknown>({
    action: 'ADD_TO_LIST',
    listName: FOLLOWED_NAMES_LIST,
    items: [normalized],
  });

  return { alreadyFollowed: false };
};
