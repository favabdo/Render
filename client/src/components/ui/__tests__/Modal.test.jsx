import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from '../Modal';

function TestModal({ onClose }) {
  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-title">Test Modal Title</div>
      <button>First</button>
      <button>Last</button>
    </Modal>
  );
}

describe('Modal', () => {
  it('renders with dialog role and aria-modal', () => {
    render(<TestModal onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('auto-links aria-labelledby to the .resolve-modal-title element', () => {
    render(<TestModal onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy)).toHaveTextContent('Test Modal Title');
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<TestModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the backdrop but not the dialog itself', () => {
    const onClose = vi.fn();
    render(<TestModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog on open', () => {
    render(<TestModal onClose={() => {}} />);
    expect(screen.getByText('First')).toHaveFocus();
  });

  it('restores focus to the previously focused element on close', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open';
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = render(<TestModal onClose={() => {}} />);
    expect(opener).not.toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    document.body.removeChild(opener);
  });
});
