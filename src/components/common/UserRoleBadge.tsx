import type { UserRole } from '../../types';
import { useTranslation } from 'react-i18next';

type UserRoleBadgeProps = {
  role: UserRole;
  className?: string;
};

const roleClasses: Record<UserRole, string> = {
  SysOp: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700',
  SuperAdmin: 'border-rose-300 bg-rose-50 text-rose-700',
  Admin: 'border-cyan-300 bg-cyan-50 text-cyan-700',
  Moderator: 'border-amber-300 bg-amber-50 text-amber-700',
  Member: 'border-slate-300 bg-slate-50 text-slate-600',
};
const roleLabelKeys: Record<UserRole, string> = {
  SysOp: 'moderation.sysOp',
  SuperAdmin: 'moderation.superAdmin',
  Admin: 'moderation.admin',
  Moderator: 'moderation.moderator',
  Member: 'common.member',
};

const UserRoleBadge = ({ role, className = '' }: UserRoleBadgeProps) => {
  const { t } = useTranslation();
  return (
    <span
      className={[
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold',
        roleClasses[role],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {t(roleLabelKeys[role])}
    </span>
  );
};

export default UserRoleBadge;
