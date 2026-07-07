import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import UserRoleBadge from '../common/UserRoleBadge';
import { useForumActions, useForumData } from '../../hooks/useForumData';
import {
  followName,
  FORUM_FOLLOW_NAME,
  isNameFollowed,
} from '../../services/qortium/followService';

type ThemeMode = 'light-cyan' | 'dark-cyan';

type HeaderProps = {
  themeMode: ThemeMode;
  onToggleTheme: () => void;
};

const SunIcon = ({ active }: { active: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className={[
      'h-4 w-4 transition',
      active ? 'text-brand-accent-strong' : 'text-ui-muted',
    ].join(' ')}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
  </svg>
);

const MoonIcon = ({ active }: { active: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className={[
      'h-4 w-4 transition',
      active ? 'text-brand-primary-strong' : 'text-ui-muted',
    ].join(' ')}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.5 14.8A8.5 8.5 0 1 1 9.2 3.5a7 7 0 1 0 11.3 11.3Z" />
  </svg>
);

const initialsFromName = (name: string | null) => {
  if (!name) {
    return 'Q';
  }

  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
};

const HelpIcon = () => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M9.7 9a2.4 2.4 0 0 1 4.6 1c0 1.7-2.3 1.9-2.3 3.6" />
    <path d="M12 17h.01" />
  </svg>
);

const Header = ({ themeMode, onToggleTheme }: HeaderProps) => {
  const { availableAuthNames, activeAuthName, currentUser } = useForumData();
  const { setCurrentUser } = useForumActions();
  const [isNameMenuOpen, setIsNameMenuOpen] = useState(false);
  const [highlightedNameIndex, setHighlightedNameIndex] = useState(0);
  const [isAvatarVisible, setIsAvatarVisible] = useState(true);
  const [isFollowed, setIsFollowed] = useState(false);
  const [isFollowChecking, setIsFollowChecking] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followFeedback, setFollowFeedback] = useState<string | null>(null);
  const nameMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const nameMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const nameOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const initials = useMemo(
    () => initialsFromName(activeAuthName ?? currentUser.displayName ?? null),
    [activeAuthName, currentUser.displayName]
  );
  const canOpenNameMenu = availableAuthNames.length > 1;

  useEffect(() => {
    setIsAvatarVisible(true);
  }, [currentUser.avatarUrl]);

  useEffect(() => {
    let active = true;
    setIsFollowChecking(true);
    setFollowFeedback(null);

    void isNameFollowed(FORUM_FOLLOW_NAME)
      .then((followed) => {
        if (!active) {
          return;
        }

        setIsFollowed(followed);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setIsFollowed(false);
        setFollowFeedback('Follow status unavailable.');
      })
      .finally(() => {
        if (active) {
          setIsFollowChecking(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const closeIfOutside = (event: MouseEvent) => {
      if (!nameMenuContainerRef.current) {
        return;
      }

      const target = event.target;
      if (
        target instanceof Node &&
        !nameMenuContainerRef.current.contains(target)
      ) {
        setIsNameMenuOpen(false);
      }
    };

    window.addEventListener('click', closeIfOutside);
    return () => {
      window.removeEventListener('click', closeIfOutside);
    };
  }, []);

  useEffect(() => {
    if (!isNameMenuOpen || availableAuthNames.length === 0) {
      return;
    }

    const activeIndex = availableAuthNames.findIndex(
      (name) => name === activeAuthName
    );
    const nextIndex = activeIndex >= 0 ? activeIndex : 0;
    setHighlightedNameIndex(nextIndex);
  }, [activeAuthName, availableAuthNames, isNameMenuOpen]);

  useEffect(() => {
    if (!isNameMenuOpen) {
      return;
    }

    nameOptionRefs.current[highlightedNameIndex]?.focus();
  }, [highlightedNameIndex, isNameMenuOpen]);

  const selectHighlightedName = () => {
    const selected = availableAuthNames[highlightedNameIndex];
    if (!selected) {
      return;
    }

    setCurrentUser(selected);
    setIsNameMenuOpen(false);
  };

  const handleNameMenuKeyDown = (event: KeyboardEvent) => {
    if (!canOpenNameMenu) {
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        setIsNameMenuOpen(false);
        nameMenuTriggerRef.current?.focus();
        return;
      case 'Tab': {
        event.preventDefault();
        if (event.shiftKey) {
          setHighlightedNameIndex((current) =>
            current === 0 ? availableAuthNames.length - 1 : current - 1
          );
        } else {
          setHighlightedNameIndex((current) =>
            current === availableAuthNames.length - 1 ? 0 : current + 1
          );
        }
        return;
      }
      case 'ArrowDown':
        event.preventDefault();
        setHighlightedNameIndex((current) =>
          Math.min(current + 1, availableAuthNames.length - 1)
        );
        return;
      case 'ArrowUp':
        event.preventDefault();
        setHighlightedNameIndex((current) => Math.max(current - 1, 0));
        return;
      case 'Home':
        event.preventDefault();
        setHighlightedNameIndex(0);
        return;
      case 'End':
        event.preventDefault();
        setHighlightedNameIndex(availableAuthNames.length - 1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectHighlightedName();
        return;
      default:
        return;
    }
  };

  const handleNameButtonKeyDown = (event: KeyboardEvent) => {
    if (!canOpenNameMenu) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsNameMenuOpen(true);
    }
  };

  const handleFollowForum = async () => {
    setIsFollowing(true);
    setFollowFeedback(null);

    try {
      const result = await followName(FORUM_FOLLOW_NAME);
      setIsFollowed(true);
      setFollowFeedback(
        result.alreadyFollowed
          ? 'Already following forum data.'
          : 'Following forum data.'
      );
    } catch (error) {
      setFollowFeedback(
        error instanceof Error ? error.message : 'Unable to follow forum data.'
      );
    } finally {
      setIsFollowing(false);
    }
  };

  return (
    <header className="bg-forum-header border-brand-primary sticky top-0 z-20 border-b backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <h1 className="text-xl tracking-tight">
          <span className="text-brand-primary font-bold">Qortium</span>{' '}
          <span className="text-ui-strong font-semibold">Discussion</span>{' '}
          <span className="text-brand-accent font-bold">Boards</span>
        </h1>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={
              themeMode === 'light-cyan'
                ? 'Switch to Dark theme'
                : 'Switch to Light theme'
            }
            title={
              themeMode === 'light-cyan'
                ? 'Switch to Dark theme'
                : 'Switch to Light theme'
            }
            className="forum-pill-primary flex items-center gap-2 rounded-md px-3 py-2"
          >
            <SunIcon active={themeMode === 'light-cyan'} />
            <MoonIcon active={themeMode === 'dark-cyan'} />
          </button>

          <div
            className="forum-card border-brand-primary relative px-2 py-2"
            ref={nameMenuContainerRef}
          >
            <button
              type="button"
              ref={nameMenuTriggerRef}
              className="flex items-center gap-3 rounded-md px-1 py-1"
              onClick={() => {
                if (!canOpenNameMenu) {
                  return;
                }
                setIsNameMenuOpen((value) => !value);
              }}
              onKeyDown={handleNameButtonKeyDown}
              disabled={!canOpenNameMenu}
              aria-label="Open identity menu"
              aria-expanded={isNameMenuOpen}
              aria-haspopup="menu"
            >
              {currentUser.avatarUrl && isAvatarVisible ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={
                    (activeAuthName ?? currentUser.displayName)
                      ? `${activeAuthName ?? currentUser.displayName} avatar`
                      : 'User avatar'
                  }
                  className="h-8 w-8 rounded-full object-cover ring-2 ring-cyan-100"
                  onError={() => setIsAvatarVisible(false)}
                />
              ) : (
                <div
                  className={`${currentUser.avatarColor} flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-cyan-100`}
                  aria-hidden="true"
                >
                  {initials}
                </div>
              )}
              <div className="leading-tight text-left">
                <p className="text-ui-strong text-sm font-semibold">
                  {activeAuthName ?? currentUser.displayName}
                </p>
                <div className="mt-1">
                  <UserRoleBadge role={currentUser.role} />
                </div>
              </div>
              {canOpenNameMenu ? (
                <span className="text-ui-muted text-xs">
                  {isNameMenuOpen ? '▴' : '▾'}
                </span>
              ) : null}
            </button>

            {canOpenNameMenu ? (
              <div
                className={[
                  'bg-surface-card absolute right-0 top-[calc(100%+6px)] z-30 min-w-44 rounded-md border border-slate-200 p-1 shadow-lg transition-all duration-150 ease-out',
                  isNameMenuOpen
                    ? 'pointer-events-auto translate-y-0 opacity-100'
                    : 'pointer-events-none -translate-y-1 opacity-0',
                ].join(' ')}
                role="menu"
                aria-hidden={!isNameMenuOpen}
                onKeyDown={handleNameMenuKeyDown}
              >
                {availableAuthNames.map((name, index) => (
                  <button
                    key={name}
                    ref={(element) => {
                      nameOptionRefs.current[index] = element;
                    }}
                    type="button"
                    tabIndex={isNameMenuOpen ? 0 : -1}
                    role="menuitemradio"
                    aria-checked={name === activeAuthName}
                    onMouseEnter={() => setHighlightedNameIndex(index)}
                    onClick={() => {
                      setCurrentUser(name);
                      setIsNameMenuOpen(false);
                    }}
                    className={[
                      'block w-full rounded-md px-3 py-2 text-left text-xs font-medium transition',
                      index === highlightedNameIndex || name === activeAuthName
                        ? 'bg-cyan-50 text-cyan-700'
                        : 'text-slate-700 hover:bg-slate-100',
                    ].join(' ')}
                  >
                    {name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="relative flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleFollowForum()}
              disabled={isFollowed || isFollowChecking || isFollowing}
              className="forum-pill-accent text-brand-accent-strong rounded-md px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isFollowChecking
                ? 'Checking...'
                : isFollowing
                  ? 'Following...'
                  : isFollowed
                    ? 'Following'
                    : 'Follow'}
            </button>
            <span className="group relative inline-flex">
              <button
                type="button"
                className="text-ui-muted rounded-full border border-slate-200 bg-white p-1 transition hover:text-cyan-700"
                aria-label="Why follow this forum?"
              >
                <HelpIcon />
              </button>
              <span className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-40 hidden w-72 rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700 shadow-lg group-hover:block group-focus-within:block">
                Follow {FORUM_FOLLOW_NAME} to help your Qortium node download and
                host this forum&apos;s QDN data. This improves availability and
                helps other peers load the forum.
              </span>
            </span>
            {followFeedback ? (
              <span className="absolute right-0 top-[calc(100%+8px)] z-30 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg">
                {followFeedback}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
