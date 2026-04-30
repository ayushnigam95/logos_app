import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PageTree } from '../components/PageTree';
import type { PageNode } from '../types';

const mockTree: PageNode = {
  page_id: '1',
  title: 'Root Page',
  translated_html: null,
  body_html: '<p>root</p>',
  url: '/root',
  children: [
    {
      page_id: '2',
      title: 'Child One',
      translated_html: null,
      body_html: '<p>child1</p>',
      url: '/child1',
      children: [],
    },
    {
      page_id: '3',
      title: 'Child Two',
      translated_html: null,
      body_html: '<p>child2</p>',
      url: '/child2',
      children: [
        {
          page_id: '4',
          title: 'Grandchild',
          translated_html: null,
          body_html: '<p>gc</p>',
          url: '/gc',
          children: [],
        },
      ],
    },
  ],
};

describe('PageTree', () => {
  it('renders all pages in the tree', () => {
    render(<PageTree tree={mockTree} selectedPageId={null} onSelectPage={vi.fn()} />);
    expect(screen.getByText(/Root Page/)).toBeInTheDocument();
    expect(screen.getByText(/Child One/)).toBeInTheDocument();
    expect(screen.getByText(/Child Two/)).toBeInTheDocument();
    expect(screen.getByText(/Grandchild/)).toBeInTheDocument();
  });

  it('calls onSelectPage when a page is clicked', () => {
    const onSelect = vi.fn();
    render(<PageTree tree={mockTree} selectedPageId={null} onSelectPage={onSelect} />);
    fireEvent.click(screen.getByText(/Child One/));
    expect(onSelect).toHaveBeenCalledWith('2');
  });

  it('highlights the selected page', () => {
    render(<PageTree tree={mockTree} selectedPageId="3" onSelectPage={vi.fn()} />);
    const selectedBtn = screen.getByText(/Child Two/);
    expect(selectedBtn).toHaveClass('selected');
  });

  it('shows folder icon for pages with children', () => {
    render(<PageTree tree={mockTree} selectedPageId={null} onSelectPage={vi.fn()} />);
    // Root and Child Two have children → folder icons
    const folderButtons = screen.getAllByText(/📁/);
    expect(folderButtons).toHaveLength(2);
    expect(folderButtons[0].textContent).toContain('Root Page');
  });

  it('shows document icon for leaf pages', () => {
    render(<PageTree tree={mockTree} selectedPageId={null} onSelectPage={vi.fn()} />);
    expect(screen.getByText(/Child One/).textContent).toContain('📄');
  });

  it('renders the heading', () => {
    render(<PageTree tree={mockTree} selectedPageId={null} onSelectPage={vi.fn()} />);
    expect(screen.getByText('Page Tree')).toBeInTheDocument();
  });
});
