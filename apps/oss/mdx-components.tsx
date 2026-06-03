import type { MDXComponents } from 'mdx/types';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import CodeBlock from '@/components/CodeBlock';

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    const props = (node as ReactElement<{ children?: ReactNode }>).props;
    return extractText(props.children);
  }
  return '';
}

function langFromClassName(className: unknown): string {
  if (typeof className !== 'string') return 'text';
  const match = className.match(/language-([\w-]+)/);
  return match ? match[1] : 'text';
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    pre(props) {
      const child = props.children;
      if (
        isValidElement(child) &&
        (child as ReactElement<{ className?: string }>).type === 'code'
      ) {
        const codeProps = (
          child as ReactElement<{ className?: string; children?: ReactNode }>
        ).props;
        const lang = langFromClassName(codeProps.className);
        const source = extractText(codeProps.children).replace(/\n$/, '');
        return <CodeBlock lang={lang}>{source}</CodeBlock>;
      }
      return <pre {...props} />;
    },
  };
}
