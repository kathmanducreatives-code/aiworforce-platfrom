import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, Brain, Clock, CheckCircle, AlertCircle, Loader2, Play } from "lucide-react";
import type { ScreeningChatMessage } from "@/types/AdaptiveScreening";

const AdaptiveScreening = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState<string>("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [readyToStart, setReadyToStart] = useState(false);
  const [messages, setMessages] = useState<ScreeningChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [currentScenario, setCurrentScenario] = useState(0);
  const [totalScenarios, setTotalScenarios] = useState(3);
  const [sessionStatus, setSessionStatus] = useState<string>("invited");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token) {
      initializeSession();
    }
  }, [token]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const initializeSession = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: funcError } = await supabase.functions.invoke('adaptive-screening-chat', {
        body: { action: 'start', token },
      });

      if (funcError) throw funcError;

      if (data.error) {
        setError(data.error);
        return;
      }

      setSessionId(data.session_id);
      setCandidateName(data.candidate_name);
      setConsentGiven(data.consent_given);
      setSessionStatus(data.session_status);
      setTotalScenarios(data.scenario_count);

      if (data.session_status === 'in_progress') {
        // Load existing conversation
        await loadConversation(data.session_id);
      }

    } catch (err: any) {
      console.error('Failed to initialize session:', err);
      setError('Failed to load screening session. Please try again or contact support.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadConversation = async (sessionId: string) => {
    const { data: logs } = await supabase
      .from('screening_conversation_logs')
      .select('*')
      .eq('session_id', sessionId)
      .order('message_index', { ascending: true });

    if (logs) {
      const loadedMessages: ScreeningChatMessage[] = logs
        .filter(log => log.role !== 'system')
        .map(log => ({
          id: log.id,
          role: log.role as 'assistant' | 'user',
          content: log.content,
          timestamp: new Date(log.created_at),
        }));
      setMessages(loadedMessages);
    }
  };

  const handleConsent = async () => {
    if (!sessionId || !consentChecked) return;

    try {
      setIsLoading(true);

      const { data, error: funcError } = await supabase.functions.invoke('adaptive-screening-chat', {
        body: { action: 'consent', session_id: sessionId },
      });

      if (funcError) throw funcError;

      setConsentGiven(true);
      setTotalScenarios(data.total_scenarios);
      // Show the "Ready to Start" screen instead of immediately starting chat
      setReadyToStart(true);

    } catch (err: any) {
      console.error('Failed to record consent:', err);
      toast.error('Failed to process consent. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const startScreening = async () => {
    if (!sessionId) return;

    try {
      setIsLoading(true);

      // Get the first scenario/welcome message from the edge function
      const { data, error: funcError } = await supabase.functions.invoke('adaptive-screening-chat', {
        body: { action: 'begin', session_id: sessionId },
      });

      if (funcError) throw funcError;

      setReadyToStart(false);
      setSessionStatus('in_progress');

      // Add welcome message
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: data.message,
        timestamp: new Date(),
      }]);

      if (data.total_scenarios) {
        setTotalScenarios(data.total_scenarios);
      }

    } catch (err: any) {
      console.error('Failed to start screening:', err);
      toast.error('Failed to start screening. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!inputValue.trim() || !sessionId || isSending) return;

    const userMessage: ScreeningChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsSending(true);

    // Add typing indicator
    const typingMessage: ScreeningChatMessage = {
      id: 'typing',
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isTyping: true,
    };
    setMessages(prev => [...prev, typingMessage]);

    try {
      const { data, error: funcError } = await supabase.functions.invoke('adaptive-screening-chat', {
        body: { 
          action: 'chat',
          session_id: sessionId, 
          message: userMessage.content,
        },
      });

      if (funcError) throw funcError;

      // Remove typing indicator and add response
      setMessages(prev => {
        const withoutTyping = prev.filter(m => m.id !== 'typing');
        return [...withoutTyping, {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        }];
      });

      setCurrentScenario(data.current_scenario_index);
      setIsComplete(data.is_complete);

    } catch (err: any) {
      console.error('Failed to send message:', err);
      // Remove typing indicator
      setMessages(prev => prev.filter(m => m.id !== 'typing'));
      toast.error('Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-white/70">Loading your screening session...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Session Unavailable</h2>
            <p className="text-slate-400">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6 text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-white mb-2">Screening Complete!</h2>
            <p className="text-slate-400 mb-6">
              Thank you for taking the time to complete this screening. 
              A recruiter will review your responses and be in touch soon.
            </p>
            <p className="text-sm text-slate-500">You can close this window now.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // New "Ready to Start" screen with prominent button
  if (readyToStart) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full bg-slate-800/50 border-slate-700">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Brain className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-4">
              You're Ready, {candidateName}!
            </h1>
            <p className="text-slate-400 mb-3 max-w-md mx-auto">
              Click the button below to begin your adaptive screening conversation.
            </p>
            <p className="text-slate-500 text-sm mb-8 max-w-md mx-auto">
              Take your time with each response—there are no time limits. 
              You'll go through {totalScenarios} workplace scenarios.
            </p>
            
            <Button 
              onClick={startScreening}
              disabled={isLoading}
              size="lg"
              className="px-12 py-6 text-lg font-semibold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 mr-3" />
                  Start Screening
                </>
              )}
            </Button>

            <p className="text-xs text-slate-600 mt-6">
              Estimated time: 10-15 minutes
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!consentGiven) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="text-center mb-6">
              <Brain className="w-12 h-12 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-white mb-2">
                Welcome, {candidateName}!
              </h1>
              <p className="text-slate-400">
                You've been invited to complete an adaptive screening assessment.
              </p>
            </div>

            <div className="space-y-4 text-slate-300 mb-6">
              <h3 className="font-semibold text-white">What to expect:</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <Clock className="w-4 h-4 mt-0.5 text-primary" />
                  <span>This will take approximately 10-15 minutes</span>
                </li>
                <li className="flex items-start gap-2">
                  <Brain className="w-4 h-4 mt-0.5 text-primary" />
                  <span>You'll have a conversation with an AI interviewer about workplace scenarios</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 mt-0.5 text-primary" />
                  <span>There are no right or wrong answers—we're interested in your thought process</span>
                </li>
              </ul>
            </div>

            <div className="bg-slate-700/50 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <Checkbox 
                  id="consent" 
                  checked={consentChecked}
                  onCheckedChange={(checked) => setConsentChecked(checked === true)}
                  className="mt-1"
                />
                <label htmlFor="consent" className="text-sm text-slate-300 cursor-pointer">
                  I understand this is an AI-assisted assessment. My responses will be reviewed by 
                  human recruiters to help them make informed decisions. I consent to participate.
                </label>
              </div>
            </div>

            <Button 
              onClick={handleConsent}
              disabled={!consentChecked || isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-800/50 p-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 text-primary" />
            <span className="font-semibold text-white">Adaptive Screening</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-400">
              Scenario {currentScenario + 1} of {totalScenarios}
            </div>
            <Progress 
              value={((currentScenario + 1) / totalScenarios) * 100} 
              className="w-24 h-2"
            />
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full" ref={scrollRef}>
          <div className="max-w-3xl mx-auto p-4 space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-slate-700 text-white'
                  }`}
                >
                  {message.isTyping ? (
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Input Area */}
      <div className="border-t border-slate-700 bg-slate-800/50 p-4">
        <div className="max-w-3xl mx-auto flex gap-3">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your response..."
            disabled={isSending}
            className="flex-1 bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
          />
          <Button 
            onClick={sendMessage}
            disabled={!inputValue.trim() || isSending}
            size="icon"
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AdaptiveScreening;
