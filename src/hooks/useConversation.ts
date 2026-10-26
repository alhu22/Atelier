import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatOptions } from "@/integrations/studioApi";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "complete" | "streaming" | "stopped" | "error";
  error?: string;
  changedFiles?: string[];
}

function loadMessages(key: string): ConversationMessage[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ConversationMessage =>
      item && typeof item.id === "string" && ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string" && typeof item.createdAt === "string" &&
      Number.isFinite(Date.parse(item.createdAt)) &&
      ["complete", "streaming", "stopped", "error"].includes(item.status) &&
      (item.error === undefined || typeof item.error === "string") &&
      (item.changedFiles === undefined || (Array.isArray(item.changedFiles) && item.changedFiles.every((path: unknown) => typeof path === "string"))),
    ).slice(-100).map((item) => item.status === "streaming" ? { ...item, status: "stopped" } : item);
  } catch {
    return [];
  }
}

export function useConversation(
  storageKey: string,
  generate: (prompt: string, options: ChatOptions) => Promise<string[]>,
) {
  const [messages, setMessages] = useState(() => loadMessages(storageKey));
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState("");
  const latest = useRef(messages);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const persist = useCallback((value: ConversationMessage[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
      if (mounted.current) setStorageError("");
    } catch {
      if (mounted.current) setStorageError("Chat could not be saved in this browser. Keep this tab open to retain it.");
    }
  }, [storageKey]);

  function replace(value: ConversationMessage[]) {
    latest.current = value.slice(-100);
    if (mounted.current) setMessages(latest.current);
  }

  useEffect(() => {
    mounted.current = true;
    const saveStopped = () => persist(latest.current.map((item): ConversationMessage =>
      item.status === "streaming" ? { ...item, status: "stopped" } : item));
    window.addEventListener("pagehide", saveStopped);
    return () => {
      mounted.current = false;
      request.current?.abort();
      window.removeEventListener("pagehide", saveStopped);
      saveStopped();
    };
  }, [persist]);

  useEffect(() => {
    const timer = window.setTimeout(() => persist(messages), 200);
    return () => window.clearTimeout(timer);
  }, [messages, persist]);

  function stop() {
    request.current?.abort();
  }

  async function respond(history: ConversationMessage[], prompt: string) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const reply: ConversationMessage = {
      id: crypto.randomUUID(), role: "assistant", content: "", createdAt: new Date().toISOString(), status: "streaming",
    };
    replace([...history, reply]);
    setBusy(true);
    function update(change: Partial<ConversationMessage>) {
      replace(latest.current.map((item) => item.id === reply.id ? { ...item, ...change } : item));
    }
    try {
      const changedFiles = await generate(prompt, {
        signal: controller.signal,
        conversation: history.slice(0, -1)
          .filter((item) => item.status === "complete" && item.content.trim())
          .slice(-20).map(({ role, content }) => ({ role, content: content.slice(-20_000) })),
        onToken(token) {
          if (!controller.signal.aborted && mounted.current) {
            reply.content += token;
            update({ content: reply.content });
          }
        },
      });
      controller.signal.throwIfAborted();
      update({ status: "complete", changedFiles, content: reply.content || (changedFiles.length ? "Your project changes are ready." : "No project changes were needed.") });
    } catch (error) {
      update(controller.signal.aborted
        ? { status: "stopped" }
        : { status: "error", error: error instanceof Error ? error.message : "Chat failed. Please retry." });
    } finally {
      request.current = null;
      if (mounted.current) {
        setBusy(false);
        persist(latest.current);
      }
    }
  }

  function send(prompt: string, editId?: string) {
    if (request.current || !prompt.trim()) return;
    const index = editId ? latest.current.findIndex((item) => item.id === editId && item.role === "user") : -1;
    const history = index >= 0 ? latest.current.slice(0, index) : latest.current;
    const message: ConversationMessage = {
      id: crypto.randomUUID(), role: "user", content: prompt.trim(), createdAt: new Date().toISOString(), status: "complete",
    };
    void respond([...history, message], message.content);
  }

  function regenerate(id: string) {
    if (request.current) return;
    const index = latest.current.findIndex((item) => item.id === id);
    if (index < 0) return;
    const preceding = latest.current.slice(0, index);
    const userIndex = preceding.reduce((last, item, index) => item.role === "user" ? index : last, -1);
    if (userIndex < 0) return;
    if (index < latest.current.length - 1 && !window.confirm("Regenerating this reply removes later messages. Continue?")) return;
    void respond(preceding.slice(0, userIndex + 1), preceding[userIndex].content);
  }

  function clear() {
    if (request.current) return;
    replace([]);
    persist([]);
  }

  return { messages, busy, storageError, send, stop, regenerate, clear };
}
