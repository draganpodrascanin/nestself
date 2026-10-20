import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveRegion, AnnouncerProvider, useAnnounce } from './LiveRegion';

describe('LiveRegion', () => {
  it('renders polite region with role=status', () => {
    render(<LiveRegion politeness="polite">Updated</LiveRegion>);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Updated');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('renders assertive region with role=alert', () => {
    render(<LiveRegion politeness="assertive">Error!</LiveRegion>);
    const el = screen.getByRole('alert');
    expect(el).toHaveTextContent('Error!');
    expect(el).toHaveAttribute('aria-live', 'assertive');
  });
});

describe('AnnouncerProvider / useAnnounce', () => {
  function AnnounceTest() {
    const { announce } = useAnnounce();
    return <button onClick={() => announce('Done')}>Click</button>;
  }

  it('provides announce function that populates the live region', async () => {
    const { findByText } = render(
      <AnnouncerProvider>
        <AnnounceTest />
      </AnnouncerProvider>,
    );
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));
    expect(await findByText('Done')).toBeInTheDocument();
  });
});
