import type { SubTopic, TopicAccess, User } from '../../types';

export const RESTRICTED_UI_ACCESS_WARNING =
  'This discussion is access-restricted in the Discussion Boards interface. Its content is still stored publicly and unencrypted on QDN and should not be treated as confidential.';

export const PUBLIC_QDN_STORAGE_NOTICE =
  'Discussion content is published publicly and unencrypted on QDN. Any access rule applied in this app is an interface restriction, not confidentiality.';

export const TOPIC_CREATION_POLICY_NOTICE =
  'This setting controls who may create sub-topics. It does not restrict who can read this main topic, and published content remains public and unencrypted on QDN.';

export const HIDDEN_CONTENT_NOTICE =
  'Hidden means hidden from standard views in this app. The underlying QDN content remains public and unencrypted.';

export const isRestrictedUiAccess = (access: TopicAccess) =>
  access !== 'everyone';

export const resolveCompatibilityAccessClassification = (
  value?: {
    access: TopicAccess;
    allowedAddresses: string[];
  } | null
) =>
  value
    ? {
        access: value.access,
        allowedAddresses: [...value.allowedAddresses],
        classificationAvailable: true as const,
      }
    : {
        // The V2 entity schema does not yet carry access policy. An absent V1
        // compatibility record is therefore unknown, never implicitly public.
        access: 'custom' as const,
        allowedAddresses: [],
        classificationAvailable: false as const,
      };

const isAdminRole = (role: User['role']) =>
  role === 'Admin' || role === 'SuperAdmin' || role === 'SysOp';

export const hasStaffReviewAccess = (role: User['role']) =>
  role === 'Moderator' ||
  role === 'Admin' ||
  role === 'SuperAdmin' ||
  role === 'SysOp';

export const resolveAccessLabel = (access: TopicAccess) => {
  switch (access) {
    case 'moderators':
      return 'Restricted in this app: staff';
    case 'admins':
      return 'Restricted in this app: admins (staff review applies)';
    case 'custom':
      return 'Restricted in this app: listed wallets (staff review applies)';
    case 'everyone':
    default:
      return 'Public';
  }
};

export const canAccessSubTopic = (
  subTopic: SubTopic,
  user: User,
  address: string | null
) => {
  // Trusted staff retain review access for moderation. This is an intentional
  // app-level override, not evidence that the QDN payload is confidential.
  if (hasStaffReviewAccess(user.role)) {
    return true;
  }

  switch (subTopic.access) {
    case 'everyone':
      return true;
    case 'moderators':
      return hasStaffReviewAccess(user.role);
    case 'admins':
      return isAdminRole(user.role);
    case 'custom':
      return Boolean(address && subTopic.allowedAddresses.includes(address));
    default:
      return false;
  }
};
