import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('keeps empty submissions in the idle state', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /ask/i }));

    expect(screen.getByPlaceholderText(/ask the ball/i)).toHaveFocus();
    expect(screen.queryByText(/shake the ball/i)).not.toBeInTheDocument();
  });

  it('locks the prompt after a question is submitted', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByPlaceholderText(/ask the ball/i), 'Should I text her?');
    await user.click(screen.getByRole('button', { name: /ask/i }));

    expect(screen.getByText(/shake the ball/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask the ball/i)).toBeDisabled();
  });

  it('reveals one answer after intentional pointer shaking', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByPlaceholderText(/ask the ball/i), 'Should I text her?');
    await user.click(screen.getByRole('button', { name: /ask/i }));

    const ball = screen.getByTestId('eight-ball');
    fireEvent.pointerDown(ball, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: 900, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: -900, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: 900, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: -900, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: 900, clientY: 0, pointerId: 1 });
    // Releasing the pointer is what now triggers the scramble + settle.
    fireEvent.pointerUp(ball, { clientX: 900, clientY: 0, pointerId: 1 });

    await waitFor(
      () => expect(screen.getByRole('button', { name: /ask again/i })).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.getByTestId('answer-text').textContent).toMatch(/\w/);
  });

  it('resets from answered to idle with the ask again action', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByPlaceholderText(/ask the ball/i), 'Should I apply today?');
    await user.click(screen.getByRole('button', { name: /ask/i }));

    const ball = screen.getByTestId('eight-ball');
    fireEvent.pointerDown(ball, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: 900, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: -900, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: 900, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: -900, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ball, { clientX: 900, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(ball, { clientX: 900, clientY: 0, pointerId: 1 });

    await waitFor(
      () => expect(screen.getByRole('button', { name: /ask again/i })).toBeInTheDocument(),
      { timeout: 4000 },
    );

    await user.click(screen.getByRole('button', { name: /ask again/i }));

    expect(screen.getByPlaceholderText(/ask the ball/i)).not.toBeDisabled();
    expect(screen.getByPlaceholderText(/ask the ball/i)).toHaveValue('');
    expect(screen.getByTestId('answer-text')).toHaveTextContent('8');
  });
});
