import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Accordion, AccordionItem } from './Accordion';
import { expectNoA11yViolations } from '../../../test/axe';

function SingleFixture() {
  return (
    <Accordion defaultValue={['one']}>
      <AccordionItem value="one" title="Item One">
        Content one
      </AccordionItem>
      <AccordionItem value="two" title="Item Two">
        Content two
      </AccordionItem>
    </Accordion>
  );
}

function MultipleFixture() {
  return (
    <Accordion multiple defaultValue={['one']}>
      <AccordionItem value="one" title="Item One">
        Content one
      </AccordionItem>
      <AccordionItem value="two" title="Item Two">
        Content two
      </AccordionItem>
    </Accordion>
  );
}

describe('Accordion', () => {
  it('click toggles aria-expanded and reveals the panel', async () => {
    const user = userEvent.setup();
    render(<SingleFixture />);

    const triggerTwo = screen.getByRole('button', { name: 'Item Two' });
    expect(triggerTwo).toHaveAttribute('aria-expanded', 'false');

    await user.click(triggerTwo);
    expect(triggerTwo).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Content two')).toBeVisible();
  });

  it('Enter and Space toggle', async () => {
    const user = userEvent.setup();
    render(<SingleFixture />);

    const triggerTwo = screen.getByRole('button', { name: 'Item Two' });
    triggerTwo.focus();
    await user.keyboard('{Enter}');
    expect(triggerTwo).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard(' ');
    expect(triggerTwo).toHaveAttribute('aria-expanded', 'false');
  });

  it('aria-controls links trigger to panel', () => {
    render(<SingleFixture />);
    const trigger = screen.getByRole('button', { name: 'Item One' });
    const panelId = trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toBeInTheDocument();
  });

  it('single mode closes the other item', async () => {
    const user = userEvent.setup();
    render(<SingleFixture />);

    const triggerOne = screen.getByRole('button', { name: 'Item One' });
    const triggerTwo = screen.getByRole('button', { name: 'Item Two' });

    expect(triggerOne).toHaveAttribute('aria-expanded', 'true');
    await user.click(triggerTwo);
    expect(triggerTwo).toHaveAttribute('aria-expanded', 'true');
    expect(triggerOne).toHaveAttribute('aria-expanded', 'false');
  });

  it('multiple mode keeps both open', async () => {
    const user = userEvent.setup();
    render(<MultipleFixture />);

    const triggerOne = screen.getByRole('button', { name: 'Item One' });
    const triggerTwo = screen.getByRole('button', { name: 'Item Two' });

    expect(triggerOne).toHaveAttribute('aria-expanded', 'true');
    await user.click(triggerTwo);
    expect(triggerTwo).toHaveAttribute('aria-expanded', 'true');
    expect(triggerOne).toHaveAttribute('aria-expanded', 'true');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<SingleFixture />);
    await expectNoA11yViolations(container);
  });
});
