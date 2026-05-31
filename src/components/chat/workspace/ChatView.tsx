import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useChatConversation } from '@/hooks/useChatConversation';
import { AGENT_BY_ID } from '@/data/agentProfiles';
import { cn } from '@/lib/utils';
import ExecutionPlanCard from './plan/ExecutionPlanCard';

const AGENT_HEX: Record<string, string> = {
  scout: '#3B82F6', aria: '#8B5CF6', penn: '#10B981', hawk: '#14B8A6', scribe: '#A855F7',
};

function InitialCircle({ slug, size = 22 }: { slug: string; size?: number }) {
  const profile = AGENT_BY_ID[slug];
  const hex = AGENT_HEX[slug] ?? '#7D8590';
  const letter = (profile?.name ?? slug).charAt(0).toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0"
      style={{
        width: size, height: size,
        backgroundColor: `${hex}26`, color: hex,
        fontSize: 11, fontWeight: 600, lineHeight: 1,
      }}
      aria-hidden
    >{letter}</div>
  );
}

function isStructured(text: string): boolean {
  if (!text) return false;
  const lines = text.split('\n');
  if (lines.length >= 4 && (text.match(/\n\s*\n/) || text.match(/^\s*[-*]\s/m) || text.match(/^\s*\d+\.\s/m))) {
    return true;
  }
  return false;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-[#484F58] hover:text-[#7D8590] transition-colors"
      aria-label="Copy"
      type="button"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      {[0, 200, 400].map((d) => (
        <span
          key={d}
          className="h-1 w-1 rounded-full bg-[#484F58] animate-pulse"
          style={{ animationDelay: `${d}ms`, animationDuration: '1s' }}
        />
      ))}
    </span>
  );
}

interface Props {
  conversationId: string;
  agentSlug: string;
  pendingUserText?: string | null;
  awaitingReply?: boolean;
}

export default function ChatView({ conversationId, agentSlug, pendingUserText, awaitingReply }: Props) {
  const { messages } = useChatConversation(conversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const profile = AGENT_BY_ID[agentSlug];

  // Hide pending user text once it appears in real messages
  const showPending = pendingUserText && !messages.some(
    (m) => m.role === 'user' && m.content === pendingUserText,
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, awaitingReply, showPending]);

  const lastIsUser = (messages[messages.length - 1]?.role === 'user') || !!showPending;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] text-[14px] leading-relaxed text-[#F0F6FC] whitespace-pre-wrap text-right">
                {m.content}
              </div>
            </div>
          );
        }
        const slug = m.agent_slug ?? agentSlug;
        const name = AGENT_BY_ID[slug]?.name ?? slug;
        const structured = isStructured(m.content);
        const meta = (m.metadata ?? null) as Record<string, any> | null;
        const planMeta = meta && meta.type === 'execution_plan' && typeof meta.plan_id === 'string'
          ? meta as { plan_id: string; plan_title?: string; task_count?: number; agents?: string[]; connector_limitations?: string[] }
          : null;
        return (
          <div key={m.id} className="flex items-start gap-3">
            <InitialCircle slug={slug} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-[#7D8590] mb-1">{name}</div>
              {structured ? (
                <div className="relative rounded-md bg-white/[0.03] border border-white/[0.06] p-4 text-[14px] leading-relaxed text-[#F0F6FC] whitespace-pre-wrap">
                  <div className="absolute top-2 right-2"><CopyButton text={m.content} /></div>
                  {m.content}
                </div>
              ) : (
                <div className={cn('text-[14px] leading-relaxed whitespace-pre-wrap', m.is_error ? 'text-[#7D8590]' : 'text-[#F0F6FC]')}>
                  {m.content}
                </div>
              )}
              {planMeta && (
                <ExecutionPlanCard
                  planId={planMeta.plan_id}
                  meta={{
                    plan_title: planMeta.plan_title,
                    task_count: planMeta.task_count,
                    agents: planMeta.agents,
                    connector_limitations: planMeta.connector_limitations,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}

      {showPending && (
        <div className="flex justify-end">
          <div className="max-w-[80%] text-[14px] leading-relaxed text-[#F0F6FC] whitespace-pre-wrap text-right opacity-80">
            {pendingUserText}
          </div>
        </div>
      )}

      {awaitingReply && lastIsUser && (
        <div className="flex items-start gap-3">
          <InitialCircle slug={agentSlug} />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-[#7D8590] mb-1">{profile?.name ?? agentSlug}</div>
            <TypingDots />
          </div>
        </div>
      )}
    </div>
  );
}
