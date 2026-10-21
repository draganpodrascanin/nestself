import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IconButton } from './IconButton';
import { Heart } from '@phosphor-icons/react/dist/ssr';
import { expectNoA11yViolations } from '../../../test/axe';

describe('IconButton', () => {
  it('has accessible name equal to label', () => {
    render(<IconButton label="Favourite" icon={<Heart />} />);
    const btn = screen.getByRole('button', { name: 'Favourite' });
    expect(btn).toBeInTheDocument();
  });

  it('renders icon as aria-hidden', () => {
    const { container } = render(<IconButton label="Favourite" icon={<Heart />} />);
    const iconSpan = container.querySelector('[aria-hidden]');
    expect(iconSpan).toBeTruthy();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<IconButton label="Close" icon={<Heart />} />);
    await expectNoA11yViolations(container);
  });
});
