import "server-only";
import sanitizeHtml from "sanitize-html";
import type { ImageInfo } from "../types";

/**
 * Makes an email safe to render inside a sandboxed iframe:
 * no scripts, forms, frames or event handlers; tracking pixels always removed;
 * remote images blocked unless `loadImages` (loading them can register an "open"
 * with the sender and change the test account's CRM journey).
 */
export function safePreviewHtml(html: string, images: ImageInfo[], loadImages: boolean): string {
  const tracking = new Set(images.filter((i) => i.is_tracking).map((i) => i.src));
  const clean = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "style", "center", "font", "span", "div", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "u", "s", "small", "big", "hr", "br"]),
    allowedAttributes: {
      "*": ["style", "class", "align", "valign", "width", "height", "bgcolor", "color", "border", "cellpadding", "cellspacing", "dir", "role", "title"],
      a: ["href", "name", "target", "style", "class"],
      img: ["src", "alt", "width", "height", "style", "class", "border"],
      font: ["face", "size", "color", "style"],
      td: ["colspan", "rowspan", "style", "class", "align", "valign", "width", "height", "bgcolor", "background"],
      th: ["colspan", "rowspan", "style", "class", "align", "valign", "width", "height", "bgcolor"],
      table: ["style", "class", "align", "width", "height", "bgcolor", "border", "cellpadding", "cellspacing", "role", "background"],
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowVulnerableTags: true, // <style> is needed for email layout; scripts are still stripped
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
      img: (tagName, attribs) => {
        const src = attribs.src ?? "";
        if (tracking.has(src)) return { tagName: "span", attribs: {} };
        if (!loadImages && /^https?:/i.test(src)) {
          const w = attribs.width ? `width:${attribs.width}px;` : "";
          const h = attribs.height ? `height:${Math.min(Number(attribs.height) || 60, 400)}px;` : "min-height:40px;";
          return {
            tagName: "span",
            attribs: {
              style: `display:inline-block;${w}${h}max-width:100%;background:#eeedea;border:1px dashed #c3c2b7;color:#52514e;font:12px system-ui;padding:4px;box-sizing:border-box;overflow:hidden`,
              title: attribs.alt || "image blocked",
            },
          };
        }
        return { tagName, attribs };
      },
    },
    nonTextTags: ["script", "noscript", "textarea", "option", "title", "head"],
  });
  const csp = loadImages
    ? "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src https: data:"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"></head><body style="margin:0;background:#fff">${clean}</body></html>`;
}
