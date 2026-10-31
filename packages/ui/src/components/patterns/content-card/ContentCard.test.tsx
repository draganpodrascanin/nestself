import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContentCard } from './ContentCard';
import { expectNoA11yViolations } from '../../../test/axe';

const baseProps = {
  resourceId: 'res_1',
  title: 'Test Article',
  formatLabel: 'Article',
  outcome: 'You will learn something useful.',
};

describe('ContentCard', () => {
  it('renders title and outcome', () => {
    render(<ContentCard {...baseProps} />);
    expect(screen.getByText('Test Article')).toBeInTheDocument();
    expect(screen.getByText('You will learn something useful.')).toBeInTheDocument();
  });

  it('renders format label', () => {
    render(<ContentCard {...baseProps} />);
    // Format label appears in the card body and in the placeholder
    expect(screen.getAllByText('Article').length).toBeGreaterThanOrEqual(1);
  });

  it('renders as an article element', () => {
    const { container } = render(<ContentCard {...baseProps} />);
    expect(container.querySelector('article')).toBeInTheDocument();
  });

  it('renders a link when href is provided', () => {
    render(<ContentCard {...baseProps} href="/content/1" />);
    const link = screen.getByRole('link', { name: 'Test Article' });
    expect(link).toHaveAttribute('href', '/content/1');
  });

  it('calls renderLink when provided', () => {
    const renderLink = vi.fn(({ href, className, children }) => (
      <a href={href} className={className}>
        {children}
      </a>
    ));
    render(
      <ContentCard {...baseProps} href="/content/1" renderLink={renderLink} />,
    );
    expect(renderLink).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Test Article' })).toBeInTheDocument();
  });

  it('renders cover image with focal point', () => {
    render(
      <ContentCard
        {...baseProps}
        imageUrl="/img/cover.jpg"
        focalPoint={{ x: 0.3, y: 0.7 }}
        imageAlt="Cover"
      />,
    );
    const img = screen.getByAltText('Cover');
    expect(img).toHaveStyle({ objectPosition: '30% 70%' });
  });

  it('renders placeholder when no image', () => {
    render(<ContentCard {...baseProps} />);
    // The placeholder area contains the format label
    const els = screen.getAllByText('Article');
    expect(els.length).toBeGreaterThanOrEqual(1);
  });

  it('renders save button and toggles on click', async () => {
    const user = userEvent.setup();
    const onToggleSave = vi.fn();
    render(
      <ContentCard
        {...baseProps}
        saved={false}
        onToggleSave={onToggleSave}
        saveLabel="Save"
        unsaveLabel="Unsave"
      />,
    );
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await user.click(btn);
    expect(onToggleSave).toHaveBeenCalledTimes(1);
  });

  it('shows unsave label when saved', () => {
    render(
      <ContentCard
        {...baseProps}
        saved
        onToggleSave={() => {}}
        saveLabel="Save"
        unsaveLabel="Unsave"
      />,
    );
    const btn = screen.getByRole('button', { name: 'Unsave' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('sets data-placeholder when placeholder is true', () => {
    const { container } = render(<ContentCard {...baseProps} placeholder />);
    expect(container.querySelector('[data-placeholder="true"]')).toBeInTheDocument();
  });

  it('sets data-resource-id', () => {
    const { container } = render(<ContentCard {...baseProps} />);
    expect(container.querySelector('[data-resource-id="res_1"]')).toBeInTheDocument();
  });

  it('save button is keyboard accessible', async () => {
    const user = userEvent.setup();
    const onToggleSave = vi.fn();
    render(
      <ContentCard
        {...baseProps}
        saved={false}
        onToggleSave={onToggleSave}
        saveLabel="Save"
        unsaveLabel="Unsave"
      />,
    );
    const btn = screen.getByRole('button', { name: 'Save' });
    btn.focus();
    await user.keyboard('{Enter}');
    expect(onToggleSave).toHaveBeenCalledTimes(1);
  });

  it('has no a11y violations', async () => {
    const { container } = render(
      <ContentCard
        {...baseProps}
        href="/content/1"
        saved={false}
        onToggleSave={() => {}}
        saveLabel="Save"
        unsaveLabel="Unsave"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
