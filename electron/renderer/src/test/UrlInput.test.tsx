import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UrlInput } from '../components/UrlInput';

describe('UrlInput', () => {
  it('renders the URL input field', () => {
    render(<UrlInput onSubmit={vi.fn()} loading={false} />);
    expect(screen.getByLabelText('Confluence Page URL')).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    render(<UrlInput onSubmit={vi.fn()} loading={false} />);
    expect(screen.getByRole('button', { name: 'Translate' })).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<UrlInput onSubmit={vi.fn()} loading={true} />);
    expect(screen.getByRole('button', { name: 'Translating...' })).toBeDisabled();
    expect(screen.getByLabelText('Confluence Page URL')).toBeDisabled();
  });

  it('calls onSubmit with correct data', () => {
    const onSubmit = vi.fn();
    render(<UrlInput onSubmit={onSubmit} loading={false} />);

    fireEvent.change(screen.getByLabelText('Confluence Page URL'), {
      target: { value: 'https://company.atlassian.net/wiki/spaces/PROJ/pages/123/Test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    expect(onSubmit).toHaveBeenCalledWith({
      confluence_url: 'https://company.atlassian.net/wiki/spaces/PROJ/pages/123/Test',
      include_children: true,
      max_depth: -1,
      target_language: 'en',
      export_pdf: true,
    });
  });

  it('shows include children checkbox checked by default', () => {
    render(<UrlInput onSubmit={vi.fn()} loading={false} />);
    expect(screen.getByLabelText('Include child pages')).toBeChecked();
  });

  it('shows max depth selector when include children is checked', () => {
    render(<UrlInput onSubmit={vi.fn()} loading={false} />);
    expect(screen.getByLabelText('Max depth')).toBeInTheDocument();
  });

  it('hides max depth when include children is unchecked', () => {
    render(<UrlInput onSubmit={vi.fn()} loading={false} />);
    fireEvent.click(screen.getByLabelText('Include child pages'));
    expect(screen.queryByLabelText('Max depth')).not.toBeInTheDocument();
  });

  it('disables submit button when URL is empty', () => {
    render(<UrlInput onSubmit={vi.fn()} loading={false} />);
    expect(screen.getByRole('button', { name: 'Translate' })).toBeDisabled();
  });
});
