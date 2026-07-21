import {
  HIDDEN_CONTENT_NOTICE,
  isRestrictedUiAccess,
  PUBLIC_QDN_STORAGE_NOTICE,
  RESTRICTED_UI_ACCESS_WARNING,
  TOPIC_CREATION_POLICY_NOTICE,
} from '../../services/forum/forumAccess.js';
import type { TopicAccess } from '../../types/index.js';

type AccessDisclosureNoticeProps =
  | { kind: 'restricted'; access: TopicAccess }
  | { kind: 'topic-creation-policy'; access: TopicAccess }
  | { kind: 'public-storage' }
  | { kind: 'hidden' };

const AccessDisclosureNotice = (props: AccessDisclosureNoticeProps) => {
  if (
    props.kind !== 'hidden' &&
    props.kind !== 'public-storage' &&
    !isRestrictedUiAccess(props.access)
  ) {
    return null;
  }

  const message =
    props.kind === 'hidden'
      ? HIDDEN_CONTENT_NOTICE
      : props.kind === 'public-storage'
        ? PUBLIC_QDN_STORAGE_NOTICE
        : props.kind === 'topic-creation-policy'
          ? TOPIC_CREATION_POLICY_NOTICE
          : RESTRICTED_UI_ACCESS_WARNING;

  return (
    <div
      role="status"
      data-access-disclosure={props.kind}
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
    >
      <strong>Public QDN notice:</strong> {message}
    </div>
  );
};

export default AccessDisclosureNotice;
