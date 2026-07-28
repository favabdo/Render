import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Avatar from '../Avatar';

describe('Avatar', () => {
  it('renders initials when no image is provided', () => {
    render(<Avatar name="Ahmed Elsawy" />);
    expect(screen.getByText('AE')).toBeInTheDocument();
  });

  it('renders an <img> when imageSrc is provided instead of initials', () => {
    render(<Avatar name="Ahmed Elsawy" imageSrc="data:image/png;base64,fake" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,fake');
    expect(screen.queryByText('AE')).not.toBeInTheDocument();
  });

  it('falls back to "?" when no name is given', () => {
    render(<Avatar name="" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
