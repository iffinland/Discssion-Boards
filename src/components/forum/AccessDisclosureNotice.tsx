import { isRestrictedUiAccess } from '../../services/forum/forumAccess.js';
import type { TopicAccess } from '../../types/index.js';
import { useTranslation } from 'react-i18next';

type AccessDisclosureNoticeProps =
  | { kind: 'restricted'; access: TopicAccess }
  | { kind: 'topic-creation-policy'; access: TopicAccess }
  | { kind: 'public-storage' }
  | { kind: 'hidden' };

const AccessDisclosureNotice = (props: AccessDisclosureNoticeProps) => {
  const { t } = useTranslation();
  if (
    props.kind !== 'hidden' &&
    props.kind !== 'public-storage' &&
    !isRestrictedUiAccess(props.access)
  ) {
    return null;
  }

  const messageKey =
    props.kind === 'hidden'
      ? 'access.hiddenData'
      : props.kind === 'public-storage'
        ? 'access.publicData'
        : props.kind === 'topic-creation-policy'
          ? 'access.creationPolicy'
          : 'access.restrictedData';

  return (
    <div
      role="status"
      data-access-disclosure={props.kind}
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
    >
      <strong>{t('access.publicQdnNotice')}</strong> {t(messageKey)}
    </div>
  );
};

export default AccessDisclosureNotice;
