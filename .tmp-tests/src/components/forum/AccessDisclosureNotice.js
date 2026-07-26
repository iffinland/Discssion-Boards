import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { isRestrictedUiAccess } from '../../services/forum/forumAccess.js';
import { useTranslation } from 'react-i18next';
const AccessDisclosureNotice = (props) => {
    const { t } = useTranslation();
    if (props.kind !== 'hidden' &&
        props.kind !== 'public-storage' &&
        !isRestrictedUiAccess(props.access)) {
        return null;
    }
    const messageKey = props.kind === 'hidden'
        ? 'access.hiddenData'
        : props.kind === 'public-storage'
            ? 'access.publicData'
            : props.kind === 'topic-creation-policy'
                ? 'access.creationPolicy'
                : 'access.restrictedData';
    return (_jsxs("div", { role: "status", "data-access-disclosure": props.kind, className: "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/20 dark:text-amber-200", children: [_jsx("strong", { children: t('access.publicQdnNotice') }), " ", t(messageKey)] }));
};
export default AccessDisclosureNotice;
