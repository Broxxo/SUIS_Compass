import { Mail } from 'lucide-react';
import { Button } from './ui/button';

export default function CompassMailbox({ isZh, onOpenInbox }: { isZh: boolean; onOpenInbox: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={onOpenInbox}
      className="h-[var(--app-topbar-control)] min-w-[2.75rem] rounded-lg px-3 text-[0.9625rem]"
      title={isZh ? '信箱' : 'Mailbox'}
      aria-label={isZh ? '信箱' : 'Mailbox'}
    >
      <Mail />
    </Button>
  );
}
