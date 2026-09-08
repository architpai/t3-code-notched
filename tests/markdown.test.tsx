import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MessageMarkdown } from "../src/renderer/MessageMarkdown";

it("renders reply Markdown while keeping HTML, images and links inert", () => {
  const html = renderToStaticMarkup(
    <MessageMarkdown
      text={[
        "## Result",
        "",
        "**Ready** with `code`.",
        "",
        "- First",
        "- Second",
        "",
        "```ts",
        "const value = 1;",
        "```",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "<script>alert(1)</script>",
        "",
        "[Link](javascript:alert(1))",
        "![Private image](https://example.com/track.png)",
      ].join("\n")}
    />,
  );
  expect(html).toContain("<h2>Result</h2>");
  expect(html).toContain("<strong>Ready</strong>");
  expect(html).toContain("<li>First</li>");
  expect(html).toContain('<pre><code class="language-ts">');
  expect(html).toContain("<table>");
  expect(html).not.toMatch(/<script|<img|href=|javascript:/);
  expect(html).toContain("Private image");
});
