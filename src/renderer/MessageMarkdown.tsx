import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Keep agent output inert: no raw HTML, external images, or navigation. */
export const MessageMarkdown = memo(function MessageMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ children, href }) => (
          <span className="markdown-link" title={href}>
            {children}
          </span>
        ),
        img: ({ alt }) => (
          <span className="markdown-image">{alt || "Image"}</span>
        ),
      }}
    >
      {text}
    </Markdown>
  );
});
