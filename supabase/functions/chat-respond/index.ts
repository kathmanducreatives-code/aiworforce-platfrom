// chat-respond: routes a chat message to the correct AI provider per agent.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

type Provider = 'openai' | 'anthropic' | 'google';

const AGENT_CONFIG: Record<string, { name: string; provider: Provider; model: string; system: string }> = {
  scout: {
    name: 'Scout', provider: 'openai', model: 'gpt-4o',
    system: "You are Scout, a talent sourcing specialist. You help find candidates, identify talent pools, and research potential hires. You are direct, efficient, and data-driven. When asked to find candidates, ask for the role, location, seniority, and key skills needed. Present findings in clean structured lists.",
  },
  aria: {
    name: 'Aria', provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
    system: "You are Aria, a screening and evaluation specialist. You analyze candidate profiles, score them against job requirements, assess cultural fit, and provide structured evaluations. You are thorough, objective, and detail-oriented.",
  },
  penn: {
    name: 'Penn', provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
    system: "You are Penn, an outreach and copywriting specialist. You draft personalized outreach emails, follow-up sequences, LinkedIn messages, and recruiting copy. You write in a professional but warm tone. You ask about the target audience and key selling points before drafting.",
  },
  hawk: {
    name: 'Hawk', provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
    system: "You are Hawk, a market intelligence analyst. You monitor competitors, analyze market trends, research companies, and provide strategic insights. You are analytical and concise. You present findings with clear takeaways.",
  },
  scribe: {
    name: 'Scribe', provider: 'anthropic', model: 'claude-sonnet-4-6',
    system: "You are Scribe, a content creation specialist. You write blog posts, LinkedIn content, job descriptions, employer branding copy, and internal communications. You adapt your tone to the audience and platform.",
  },
};

interface Msg { role: 'user' | 'assistant'; content: string }

async function callOpenAI(model: string, system: string, history: Msg[]): Promise<{ text: string; tokens?: number }> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...history],
      max_tokens: 1500,
    }),
  });
  if (!r.ok) throw new Error(`openai ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { text: j.choices?.[0]?.message?.content ?? '', tokens: j.usage?.total_tokens };
}

async function callAnthropic(model: string, system: string, history: Msg[]): Promise<{ text: string; tokens?: number }> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, system, max_tokens: 1500, messages: history }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const text = (j.content ?? []).map((c: any) => c.text ?? '').join('');
  const tokens = (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0);
  return { text, tokens };
}

async function callGoogle(model: string, system: string, history: Msg[]): Promise<{ text: string; tokens?: number }> {
  const key = Deno.env.get('GOOGLE_AI_API_KEY');
  if (!key) throw new Error('GOOGLE_AI_API_KEY missing');
  // Prepend system as first user turn; alternate user/model
  const contents: any[] = [{ role: 'user', parts: [{ text: system }] }, { role: 'model', parts: [{ text: 'Understood.' }] }];
  for (const m of history) {
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  });
  if (!r.ok) throw new Error(`google ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  return { text };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    // `getUser`, like every other function in this repo.
    //
    // This was the sole caller of `auth.getClaims`, which the pinned
    // supabase-js@2 typings do not carry — the one thing standing between this
    // function and a clean typecheck. Aligning it is also the safer of the two:
    // `getClaims` verifies the JWT locally, so a session revoked seconds ago
    // still presents a valid signature, while `getUser` asks the auth server and
    // rejects it. For a token arriving from a browser that is the difference
    // that matters.
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const agentSlug = typeof body?.agent_slug === 'string' ? body.agent_slug.toLowerCase() : '';
    const channel = typeof body?.channel === 'string' ? body.channel : null;
    let conversationId: string | null = typeof body?.conversation_id === 'string' ? body.conversation_id : null;

    if (!message || !agentSlug) {
      return new Response(JSON.stringify({ error: 'message and agent_slug required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const cfg = AGENT_CONFIG[agentSlug];
    if (!cfg) {
      return new Response(JSON.stringify({ error: `Unknown agent: ${agentSlug}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get/create conversation
    if (!conversationId) {
      const { data: conv, error: cErr } = await supabase
        .from('conversations')
        .insert({ user_id: userId, agent_slug: agentSlug, channel, title: message.slice(0, 50), status: 'active' })
        .select('id')
        .single();
      if (cErr || !conv) throw new Error(`create conversation: ${cErr?.message}`);
      conversationId = conv.id;
    } else {
      const { data: existing, error: gErr } = await supabase
        .from('conversations').select('id, user_id').eq('id', conversationId).single();
      if (gErr || !existing || existing.user_id !== userId) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Save user message
    await supabase.from('messages').insert({ conversation_id: conversationId, role: 'user', content: message });

    // Load last 20
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20);

    const trimmed: Msg[] = (history ?? []).map((m: any) => ({ role: m.role, content: m.content }));

    let answer = '';
    let tokens: number | undefined;
    let isError = false;
    try {
      const r = cfg.provider === 'openai'
        ? await callOpenAI(cfg.model, cfg.system, trimmed)
        : cfg.provider === 'anthropic'
        ? await callAnthropic(cfg.model, cfg.system, trimmed)
        : await callGoogle(cfg.model, cfg.system, trimmed);
      answer = r.text || "I didn't get a response. Please try again.";
      tokens = r.tokens;
    } catch (err) {
      console.error('provider error', err);
      answer = "I couldn't process that request. Please try again.";
      isError = true;
    }

    const { data: saved, error: sErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: answer,
        agent_slug: agentSlug,
        model_used: cfg.model,
        tokens_used: tokens,
        is_error: isError,
      })
      .select('*').single();
    if (sErr) console.error('save assistant', sErr);

    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

    return new Response(JSON.stringify({ conversation_id: conversationId, message: saved, error: isError }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('chat-respond error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
