import type { SubTopic, TopicAccess, User } from '../../types';

const isAdminRole = (role: User['role']) =>
  role === 'Admin' || role === 'SuperAdmin' || role === 'SysOp';

const isModeratorRole = (role: User['role']) =>
  role === 'Moderator' ||
  role === 'Admin' ||
  role === 'SuperAdmin' ||
  role === 'SysOp';

export const resolveAccessLabel = (access: TopicAccess) => {
  switch (access) {
    case 'moderators':
      return 'Moderators+';
    case 'admins':
      return 'Admins only';
    case 'custom':
      return 'Specific wallets';
    case 'everyone':
    default:
      return 'Everyone';
  }
};

export const canAccessSubTopic = (
  subTopic: SubTopic,
  user: User,
  address: string | null
) => {
  if (isModeratorRole(user.role)) {
    return true;
  }

  switch (subTopic.access) {
    case 'everyone':
      return true;
    case 'moderators':
      return isModeratorRole(user.role);
    case 'admins':
      return isAdminRole(user.role);
    case 'custom':
      return Boolean(address && subTopic.allowedAddresses.includes(address));
    default:
      return false;
  }
};
