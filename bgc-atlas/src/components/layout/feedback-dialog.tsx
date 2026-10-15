'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmailLink } from '@/components/layout/email-link';
import { apiFetch } from '@/lib/basePath';
import { FEEDBACK_MESSAGE_MAX } from '@/lib/feedback/feedback';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

export function FeedbackDialog({ children, className }: { children?: ReactNode; className?: string }) {
  // Read from the location when the dialog opens: useSearchParams in this footer would
  // make every statically rendered page need a Suspense boundary.
  const [page, setPage] = useState('/');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');   // honeypot; people never see it
  const [state, setState] = useState<State>({ kind: 'idle' });

  const reset = () => {
    setMessage('');
    setEmail('');
    setWebsite('');
    setState({ kind: 'idle' });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ kind: 'sending' });
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, email, page, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setState({ kind: 'error', message: data.error || 'Something went wrong. Please email us instead.' });
        return;
      }
      setState({ kind: 'sent' });
    } catch {
      setState({ kind: 'error', message: 'Could not reach the server. Please email us instead.' });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPage(`${window.location.pathname}${window.location.search}`);
        setOpen(next);
        if (!next && state.kind === 'sent') reset();
      }}
    >
      <DialogTrigger asChild>
        {children ?? (
          <button
            type="button"
            className={`inline-flex items-center gap-2 text-sm text-foreground underline-offset-4 hover:underline ${className ?? ''}`}
          >
            <MessageSquare className="size-4" aria-hidden />
            Send feedback
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Something slow, unclear or wrong? A feature you need? Tell us; we read every message.
          </DialogDescription>
        </DialogHeader>

        {state.kind === 'sent' ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Thank you. Your message reached us{email ? ', and we will reply if it needs an answer' : ''}.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="feedback-message">Message</Label>
              <Textarea
                id="feedback-message"
                required
                rows={6}
                maxLength={FEEDBACK_MESSAGE_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What happened, or what would help?"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feedback-email">
                Your email <span className="font-normal text-muted-foreground">(optional, only to reply)</span>
              </Label>
              <Input
                id="feedback-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {/* Honeypot: off-screen and out of the tab order, so only a bot fills it. */}
            <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
              <label htmlFor="feedback-website">Website</label>
              <input
                id="feedback-website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            {state.kind === 'error' && (
              <p role="alert" className="text-sm text-destructive">{state.message}</p>
            )}
            <DialogFooter className="items-center gap-3 sm:justify-between">
              <EmailLink
                className="text-sm text-muted-foreground underline underline-offset-2"
                ariaLabel="Email us instead"
                subject={`BGC Atlas feedback (${page})`}
              >
                Or email us instead
              </EmailLink>
              <Button type="submit" disabled={state.kind === 'sending' || !message.trim()}>
                {state.kind === 'sending' ? 'Sending…' : 'Send'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
