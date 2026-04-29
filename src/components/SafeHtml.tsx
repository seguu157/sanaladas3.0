import React, { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';

interface Props {
  html: string;
  className?: string;
}

// Único punto de la app que pinta HTML.
// DOMPurify.sanitize con RETURN_DOM_FRAGMENT: true devuelve un
// DocumentFragment ya saneado (allowlist: b, u, br) que insertamos con
// replaceChildren — sin tocar innerHTML ni dangerouslySetInnerHTML.
const SafeHtml: React.FC<Props> = ({ html, className }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fragment = DOMPurify.sanitize(html ?? '', {
      ALLOWED_TAGS: ['b', 'u', 'br'],
      ALLOWED_ATTR: [],
      RETURN_DOM_FRAGMENT: true,
    }) as unknown as DocumentFragment;
    node.replaceChildren(fragment);
  }, [html]);

  return <div ref={ref} className={className} />;
};

export default SafeHtml;
