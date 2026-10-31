import type { ReactNode } from "react";
import type { ModelRow } from "./models-shared";

export function ModelIdentity({ model, label, off }: { model: ModelRow; label: ReactNode; off: boolean }) {
  const separator = model.id.includes("/") ? model.id.indexOf("/") : model.id.indexOf("-");
  const ckey = !model.native && (model.provider === "ckey" || model.provider === "ckey-vn");
  const parts = separator > 0 && separator < model.id.length - 1
    ? [model.id.slice(0, separator), model.id.slice(separator + 1)] : null;
  const href = ckey && parts && parts.every(part => /^[a-zA-Z0-9._-]+$/.test(part) && part !== "." && part !== "..")
    ? `https://ckey.vn/llm-api/m/${parts.map(part => encodeURIComponent(part.toLowerCase())).join("/")}` : null;
  const code = <code className="mono text-control" style={{ color: off ? "var(--faint)" : "var(--text)", textDecoration: off ? "line-through" : "none" }}>{label}</code>;
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>{code}</a> : code;
}
