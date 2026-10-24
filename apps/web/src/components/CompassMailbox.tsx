import { useCallback, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import {
  fetchMailboxSummary,
  MAILBOX_BADGE_REFRESH_EVENT,
} from '../lib/mailboxApi';
import { Button } from './ui/button';

const POLL_MS = 60_000;

export default function CompassMailbox({
  isZh,
  onOpenInbox,
}: {
  isZh: boolean;
  onOpenInbox: () => void;
}) {
  const [openCount, setOpenCount] = useState(0);

  const reload = useCallback(() => {
    fetchMailboxSummary()
      .then((summary) => {
        setOpenCount(summary.viewerIsAdmin ? Math.max(0, summary.openCount) : 0);
      })
      .catch(() => {
        /* 角标失败不打扰主流程 */
      });
  }, []);

  useEffect(() => {
    reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const onRefresh = () => reload();
    const timer = window.setInterval(reload, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(MAILBOX_BADGE_REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(MAILBOX_BADGE_REFRESH_EVENT, onRefresh);
    };
  }, [reload]);

  const badgeText = openCount > 99 ? '99+' : String(openCount);

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={onOpenInbox}
      className="relative h-[var(--app-topbar-control)] min-w-[2.75rem] rounded-lg px-3 text-[0.9625rem]"
      title={
        isZh
          ? openCount > 0
            ? `信箱（${openCount} 条待处理）`
            : '信箱'
          : openCount > 0
            ? `Mailbox (${openCount} open)`
            : 'Mailbox'
      }
      aria-label={
        isZh
          ? openCount > 0
            ? `信箱，${openCount} 条待处理`
            : '信箱'
          : openCount > 0
            ? `Mailbox, ${openCount} open`
            : 'Mailbox'
      }
    >
      <Mail />
      {openCount > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground shadow-sm">
          {badgeText}
        </span>
      ) : null}
    </Button>
  );
}
