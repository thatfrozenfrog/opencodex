import { Fragment } from "react";

/** Render a small safe Markdown subset as React text, never provider-supplied HTML. */
export function PlaygroundMessageContent({ content }: { content: string }) {
  return content.split(/(```[\s\S]*?(?:```|$))/g).map((block, index) => {
    if (block.startsWith("```")) {
      const newline = block.indexOf("\n");
      const code = newline < 0 ? block.slice(3) : block.slice(newline + 1).replace(/```$/, "");
      return <pre key={index}><code>{code}</code></pre>;
    }
    return <Fragment key={index}>{block.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, partIndex) => {
      if (part.startsWith("`") && part.endsWith("`")) return <code key={partIndex}>{part.slice(1, -1)}</code>;
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
      return <Fragment key={partIndex}>{part}</Fragment>;
    })}</Fragment>;
  });
}
