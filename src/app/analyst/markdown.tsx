import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Tiny, safe Markdown renderer for analyst answers: paragraphs, headings, bold,
 * italics, inline code, bullet/numbered lists, tables and links. Never renders raw HTML.
 * Links are only allowed when relative ("/...") or http(s).
 */
function safeHref(href: string): string | null {
  const h = href.trim();
  if (h.startsWith("/") && !h.startsWith("//")) return h;
  if (/^https?:\/\//i.test(h)) return h;
  return null;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*\s][^*]*)\*)|(_([^_\s][^_]*)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1]) {
      const href = safeHref(m[3]);
      if (!href) out.push(m[2]);
      else if (href.startsWith("/"))
        out.push(
          <Link key={k} href={href} className="text-accent underline-offset-2 hover:underline">
            {m[2]}
          </Link>,
        );
      else
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline-offset-2 hover:underline">
            {m[2]}
          </a>,
        );
    } else if (m[4]) out.push(<strong key={k}>{inline(m[5], k)}</strong>);
    else if (m[6]) out.push(<code key={k} className="rounded bg-surface-2 px-1 text-[0.9em]">{m[7]}</code>);
    else if (m[8]) out.push(<em key={k}>{m[9]}</em>);
    else if (m[10]) out.push(<em key={k}>{m[11]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const k = `b${key++}`;
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        <p key={k} className={level <= 2 ? "mt-4 text-base font-semibold text-ink" : "mt-3 text-sm font-semibold text-ink"}>
          {inline(heading[2], k)}
        </p>,
      );
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k} className="my-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-2">
                {head.map((h, j) => (
                  <th key={j} className="px-2 py-1.5 font-medium">
                    {inline(h, `${k}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular">
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="px-2 py-1.5 align-top">
                      {inline(c, `${k}r${ri}c${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
        // continuation lines (indented, not a new item)
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += " " + lines[i++].trim();
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={k} className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${k}-${j}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !(isTableRow(lines[i]) && isTableSep(lines[i + 1] ?? ""))) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={k} className="my-2">
        {inline(para.join(" "), k)}
      </p>,
    );
  }
  return <div className="text-sm leading-relaxed text-ink">{blocks}</div>;
}
