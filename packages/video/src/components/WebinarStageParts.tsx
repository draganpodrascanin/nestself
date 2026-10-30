/** Small pieces shared by the webinar components: the animated error stack (error visibility rule) and the polite announcer (WBN-15). */
import { Alert, AnimatePresence, LiveRegion, VisuallyHidden, m, useMotionPreset } from '@nestself/ui';

/** Failures, each animated in and out. Render inside `MotionFeatures`. */
export function ErrorStack({ messages, testId }: { messages: readonly string[]; testId: string }) {
  const motion = useMotionPreset('popover');
  return (
    <AnimatePresence initial={false}>
      {messages.map((message) => (
        <m.div key={message} {...motion} data-testid={testId} className="origin-top">
          <Alert tone="danger">{message}</Alert>
        </m.div>
      ))}
    </AnimatePresence>
  );
}

/** A polite, visually hidden live region; `testId` sits on the text for tests. */
export function Announcer({ announcement, testId }: { announcement: { id: number; text: string }; testId: string }) {
  return (
    <VisuallyHidden as="div">
      <LiveRegion politeness="polite">
        <span key={announcement.id} data-testid={testId}>
          {announcement.text}
        </span>
      </LiveRegion>
    </VisuallyHidden>
  );
}
