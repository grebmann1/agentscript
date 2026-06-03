import { tokenize } from '@/lib/highlight';
import CopyButton from './CopyButton';

type Lang =
  | 'bash'
  | 'sh'
  | 'shell'
  | 'ts'
  | 'tsx'
  | 'js'
  | 'agent'
  | 'yaml'
  | 'json'
  | string;

export default function CodeBlock({
  lang,
  children,
}: {
  lang: Lang;
  children: string;
}) {
  const source = children;
  const tokens = tokenize(lang, source);
  return (
    <pre data-lang={lang} data-source={source}>
      <code>
        {tokens.map((t, i) =>
          t.kind ? (
            <span key={i} className={`tok-${t.kind}`}>
              {t.text}
            </span>
          ) : (
            <span key={i}>{t.text}</span>
          )
        )}
      </code>
      <CopyButton source={source} />
    </pre>
  );
}
