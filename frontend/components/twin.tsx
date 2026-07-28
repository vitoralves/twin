'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, User } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface TwinProps {
  onQuotaChange?: (quota: { remaining: number; daily_limit: number }) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function Twin({ onQuotaChange }: TwinProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState(5);
  const [limitReached, setLimitReached] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    fetch(`${API_URL}/quota`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setRemaining(data.remaining);
        setDailyLimit(data.daily_limit);
        setLimitReached(data.remaining <= 0);
        onQuotaChange?.({ remaining: data.remaining, daily_limit: data.daily_limit });
      })
      .catch(() => undefined);
  }, [onQuotaChange]);

  const updateQuota = (nextRemaining: number, nextLimit: number) => {
    setRemaining(nextRemaining);
    setDailyLimit(nextLimit);
    setLimitReached(nextRemaining <= 0);
    onQuotaChange?.({ remaining: nextRemaining, daily_limit: nextLimit });
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading || limitReached) return;

    const content = input.trim().slice(0, 1000);
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          session_id: sessionId || undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 429) {
        const detail = data.detail;
        const message =
          typeof detail === 'object' && detail?.message
            ? detail.message
            : 'This demo has reached its shared daily chat limit. Please try again tomorrow (UTC).';
        setLimitReached(true);
        updateQuota(0, detail?.daily_limit ?? dailyLimit);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: message,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      if (!response.ok) {
        const detail =
          typeof data.detail === 'string'
            ? data.detail
            : Array.isArray(data.detail)
              ? data.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(' ')
              : 'Something went wrong sending that message.';
        throw new Error(detail || 'Failed to send message');
      }

      if (!sessionId) setSessionId(data.session_id);
      if (typeof data.remaining === 'number') {
        updateQuota(data.remaining, data.daily_limit ?? dailyLimit);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Sorry — I could not complete that reply.';
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: message,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <div className="flex items-center gap-3">
          <img
            src="/avatar.png"
            alt="Vitor Alves"
            className="h-11 w-11 rounded-full object-cover ring-1 ring-[var(--line)]"
          />
          <div>
            <p className="font-[family-name:var(--font-display)] text-lg text-[var(--sand)]">
              Digital Twin
            </p>
            <p className="text-sm text-[var(--sand-muted)]">Ask about work, stack, or how this was built</p>
          </div>
        </div>
        {remaining !== null && (
          <p className="rounded-full border border-[var(--line)] px-3 py-1 text-xs tracking-wide text-[var(--sand-muted)]">
            {remaining}/{dailyLimit} left today
          </p>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 && (
          <div className="animate-rise mx-auto max-w-md pt-10 text-center">
            <img
              src="/avatar.png"
              alt="Vitor Alves"
              className="mx-auto mb-5 h-24 w-24 rounded-full object-cover ring-2 ring-[rgba(208,138,74,0.35)]"
            />
            <p className="font-[family-name:var(--font-display)] text-2xl text-[var(--sand)]">
              Hey — I&apos;m Vitor&apos;s twin.
            </p>
            <p className="mt-3 text-[var(--sand-muted)]">
              Ask about frontend engineering, AI in production, or the AWS path behind this page.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {message.role === 'assistant' && (
              <img
                src="/avatar.png"
                alt=""
                className="mt-1 h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]"
              />
            )}
            <div
              className={`max-w-[78%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                message.role === 'user'
                  ? 'bg-[var(--copper)] text-[#1a120c]'
                  : 'border border-[var(--line)] bg-[rgba(255,248,240,0.04)] text-[var(--sand)]'
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              <p
                className={`mt-2 text-[11px] ${
                  message.role === 'user' ? 'text-[#3d2a1c]/60' : 'text-[var(--sand-muted)]'
                }`}
              >
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            {message.role === 'user' && (
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(255,248,240,0.08)]">
                <User className="h-4 w-4 text-[var(--sand-muted)]" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start">
            <img
              src="/avatar.png"
              alt=""
              className="mt-1 h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]"
            />
            <div className="rounded-2xl border border-[var(--line)] bg-[rgba(255,248,240,0.04)] px-4 py-3">
              <div className="flex space-x-2">
                <div className="h-2 w-2 rounded-full bg-[var(--sand-muted)] animate-bounce" />
                <div className="h-2 w-2 rounded-full bg-[var(--sand-muted)] animate-bounce delay-100" />
                <div className="h-2 w-2 rounded-full bg-[var(--sand-muted)] animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-[var(--line)] p-4">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 1000))}
            onKeyDown={handleKeyDown}
            placeholder={
              limitReached
                ? 'Daily shared limit reached — try again tomorrow (UTC)'
                : 'Ask the twin something…'
            }
            rows={1}
            className="max-h-32 min-h-[48px] flex-1 resize-none rounded-xl border border-[var(--line)] bg-[rgba(0,0,0,0.25)] px-4 py-3 text-[var(--sand)] placeholder:text-[var(--sand-muted)] focus:border-[var(--copper)] focus:outline-none focus:ring-1 focus:ring-[var(--copper)]"
            disabled={isLoading || limitReached}
            autoFocus
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || isLoading || limitReached}
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--copper)] text-[#1a120c] transition hover:bg-[var(--copper-deep)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send message"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
