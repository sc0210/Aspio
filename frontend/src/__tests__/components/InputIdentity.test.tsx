import React from 'react';
import { render, screen } from '@testing-library/react';
import { Input } from '@/components/ui/Input';
import { Sparkline } from '@/components/portfolio/Sparkline';

/**
 * Both components used to build their ids from Math.random() during render.
 *
 * For Input that made htmlFor / aria-describedby differ between the server and
 * client render of the same field — a hydration mismatch on, among others, the
 * sign-in page. For Sparkline it minted a new gradient id every render, so the
 * fill's url(#...) pointed at a def being replaced in the same commit.
 *
 * Neither symptom shows up in a type-check, and neither component had a test.
 */
describe('Input identity', () => {
  it('associates its label with its input', () => {
    render(<Input label="Display name" />);
    expect(screen.getByLabelText('Display name')).toBe(screen.getByRole('textbox'));
  });

  it('keeps the same id across re-renders', () => {
    const { rerender } = render(<Input label="Amount" />);
    const first = screen.getByRole('textbox').id;
    rerender(<Input label="Amount" />);
    expect(screen.getByRole('textbox').id).toBe(first);
    expect(first).toBeTruthy();
  });

  it('gives two instances distinct ids', () => {
    render(
      <>
        <Input label="First field" />
        <Input label="Second field" />
      </>
    );
    const [a, b] = screen.getAllByRole('textbox');
    expect(a.id).not.toBe(b.id);
    // and each label still points at its own input
    expect(screen.getByLabelText('First field')).toBe(a);
    expect(screen.getByLabelText('Second field')).toBe(b);
  });

  it('honours an explicit id instead of generating one', () => {
    render(<Input id="chosen-id" label="Explicit" />);
    expect(screen.getByRole('textbox').id).toBe('chosen-id');
  });

  it('points aria-describedby at the error it renders', () => {
    render(<Input label="Amount" error="Too large" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent('Too large');
  });
});

describe('Sparkline gradient identity', () => {
  const data = [1, 2, 3, 4];

  it('keeps its gradient id stable across re-renders', () => {
    const { container, rerender } = render(<Sparkline data={data} />);
    const first = container.querySelector('linearGradient')?.id;
    rerender(<Sparkline data={data} />);
    expect(container.querySelector('linearGradient')?.id).toBe(first);
    expect(first).toBeTruthy();
  });

  it('points the fill at a gradient that exists in the same svg', () => {
    const { container } = render(<Sparkline data={data} />);
    const gradientId = container.querySelector('linearGradient')?.id as string;
    const filled = container.querySelector('path[fill^="url("]');
    expect(filled?.getAttribute('fill')).toBe(`url(#${gradientId})`);
  });

  it('gives two instances distinct gradient ids', () => {
    const { container } = render(
      <>
        <Sparkline data={data} />
        <Sparkline data={[4, 3, 2, 1]} />
      </>
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces an id safe for a url(#...) reference', () => {
    const { container } = render(<Sparkline data={data} />);
    // useId emits colons, which break url(#id) references in SVG
    expect(container.querySelector('linearGradient')?.id).not.toContain(':');
  });
});
