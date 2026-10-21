"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, RotateCcw } from "lucide-react";
import { buttonClass, secondaryButtonClass } from "@/components/ui";
import { Markdown } from "./markdown";

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };

const EXAMPLES = [
  "What are the biggest changes among our competitors this week?",
  "Compare the welcome offers from all tracked brands.",
  "Which competitor has become more aggressive over the past 30 days?",
  "Show me brands promoting cashback above 15%.",
  "Which competitors launched new VIP campaigns?",
  "What offers are expiring this weekend?",
  "Compare the first 14 days after registration across our test accounts.",
  "What promotion types are underrepresented among tracked competitors?",
  "Create a weekly CRM market intelligence report.",
  "Which competitor campaigns should our CRM team review?",
];

const STORAGE_KEY = "analyst-chat-v1";

export function AnalystChat({ enabled }: { enabled: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the conversation across page reloads (this browser only).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/analyst", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Failed turns are not sent back to the model.
        body: JSON.stringify({ messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }),
      });
      const data = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (!res.ok || !data.answer) throw new Error(data.error ?? `Request failed (${res.status}).`);
      setMessages((m) => [...m, { role: "assistant", content: data.answer! }]);
    } catch (err) {
      // Drop the failed question from history so the next turn starts clean.
      setMessages((m) => [...m.slice(0, -1).concat({ role: "user", content: q, error: true }), { role: "assistant", content: err instanceof Error ? err.message : "Something went wrong.", error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col rounded-xl border border-line bg-surface">
      <div className="flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-ink-2">Ask about competitor CRM activity. Answers come from the structured email database and link to the supporting emails and campaigns.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  type="button"
                  disabled={!enabled}
                  onClick={() => send(e)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.error ? "bg-surface-2 text-muted line-through" : "bg-accent text-accent-ink"}`}>{m.content}</div>
            </div>
          ) : (
            <div key={i} className={`max-w-[95%] ${m.error ? "rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad" : ""}`}>
              {m.error ? m.content : <Markdown text={m.content} />}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
            </span>
            Analyzing the database… this can take up to a minute.
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          disabled={!enabled}
          placeholder={enabled ? "Ask a question about your competitors…" : "Set OPENAI_API_KEY to enable the analyst"}
          className="min-h-[44px] flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        {messages.length > 0 && (
          <button type="button" title="New conversation" className={secondaryButtonClass} onClick={() => setMessages([])} disabled={busy}>
            <RotateCcw size={16} />
          </button>
        )}
        <button type="submit" className={buttonClass} disabled={!enabled || busy || !input.trim()} title="Send">
          <ArrowUp size={16} />
        </button>
      </form>
    </div>
  );
}
