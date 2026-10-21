import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Markdown } from '@/components/Markdown';

describe('componente Markdown', () => {
  it('pinta las negritas como negritas y no deja los asteriscos', () => {
    const { container } = render(<Markdown text="La capital es **Canberra**." />);
    expect(screen.getByText('Canberra').tagName).toBe('STRONG');
    expect(container.textContent).toBe('La capital es Canberra.');
    expect(container.textContent).not.toContain('*');
  });

  it('cursivas, código en línea y bloques de código', () => {
    const { container } = render(
      <Markdown text={'una *idea* con `código`\n\n```\nlet x = 1;\n```'} />,
    );
    expect(screen.getByText('idea').tagName).toBe('EM');
    expect(screen.getByText('código').tagName).toBe('CODE');
    expect(container.querySelector('pre')?.textContent).toBe('let x = 1;');
  });

  it('listas con viñetas y numeradas', () => {
    const { container } = render(<Markdown text={'- uno\n- **dos**\n\n1. primero\n2. segundo'} />);
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(screen.getByText('dos').tagName).toBe('STRONG');
  });

  it('el cursor de la respuesta en streaming va pegado al final del último bloque', () => {
    const { container } = render(
      <Markdown text="Es **Can" trailing={<i data-testid="cursor" />} />,
    );
    const cursor = screen.getByTestId('cursor');
    expect(cursor.closest('p')).toBe(container.querySelector('p'));
    expect(container.textContent).toBe('Es Can');
  });

  it('sin texto solo se ve el cursor, y sin cursor no se pinta nada', () => {
    const { container, rerender } = render(
      <Markdown text="" trailing={<i data-testid="cursor" />} />,
    );
    expect(screen.getByTestId('cursor')).toBeInTheDocument();
    rerender(<Markdown text="" />);
    expect(container.firstChild).toBeNull();
  });

  it('el HTML que mande la IA se muestra como texto, nunca se interpreta', () => {
    const { container } = render(
      <Markdown text={'<img src=x onerror="alert(1)"> y <b>hola</b>'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });
});
