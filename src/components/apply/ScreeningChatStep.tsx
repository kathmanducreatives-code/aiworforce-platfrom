import { useState, useEffect, useRef } from "react";
import { Send, Bot, User, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";

interface Question {
  question: string;
  type: string;
  context: string;
}

interface ScreeningChatStepProps {
  applicationId: string;
  extractedData: any;
  onComplete: () => void;
}

interface Message {
  role: 'assistant' | 'user';
  content: string;
}

export default function ScreeningChatStep({ applicationId, extractedData, onComplete }: ScreeningChatStepProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [answers, setAnswers] = useState<any[]>([]);
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const [tabSwitches, setTabSwitches] = useState(0);
  const [startTime] = useState(Date.now());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const candidateName = extractedData?.name?.split(' ')[0] || 'there';

  // Tab switch detection
  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        setTabSwitches((prev) => prev + 1);
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Generate questions on mount
  useEffect(() => {
    async function loadQuestions() {
      try {
        const { data, error } = await supabase.functions.invoke('screen-candidate', {
          body: { action: 'generate_questions', application_id: applicationId },
        });
        if (error) throw error;

        const qs = data.questions || [];
        setQuestions(qs);
        if (qs.length > 0) {
          setMessages([{ role: 'assistant', content: qs[0].question }]);
          setQuestionStartTime(Date.now());
        }
      } catch (err) {
        console.error('Failed to generate questions:', err);
        setMessages([{ role: 'assistant', content: `Hi ${candidateName}! Tell me about your most relevant experience for this role.` }]);
        setQuestions([{ question: `Tell me about your most relevant experience for this role.`, type: 'experience', context: 'Fallback' }]);
      } finally {
        setIsLoading(false);
      }
    }
    loadQuestions();
  }, [applicationId, candidateName]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (input.trim().length < 50 || isSending) return;

    const answer = input.trim();
    const timeSpent = Math.round((Date.now() - questionStartTime) / 1000);
    setInput('');
    setIsSending(true);

    // Add user message
    setMessages((prev) => [...prev, { role: 'user', content: answer }]);

    try {
      // Evaluate answer
      const { data: evalData } = await supabase.functions.invoke('screen-candidate', {
        body: { action: 'evaluate_answer', application_id: applicationId, answer, question_index: currentIndex },
      });

      const evaluation = evalData?.evaluation || { score: 5, analysis: '', sentiment: 'neutral' };

      const newAnswer = {
        question: questions[currentIndex]?.question || '',
        answer,
        score: evaluation.score,
        analysis: evaluation.analysis,
        sentiment: evaluation.sentiment,
        time_seconds: timeSpent,
      };

      const updatedAnswers = [...answers, newAnswer];
      setAnswers(updatedAnswers);

      // Save answers to DB
      const totalTime = Math.round((Date.now() - startTime) / 1000);
      await supabase
        .from('screening_applications')
        .update({
          screening_answers: updatedAnswers,
          tab_switches: tabSwitches,
          total_time_seconds: totalTime,
        })
        .eq('id', applicationId);

      const nextIndex = currentIndex + 1;

      if (nextIndex >= questions.length) {
        // All questions answered — complete screening
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Thank you ${candidateName}! You've completed all the screening questions. We appreciate your time! 🎉`,
        }]);

        // Trigger scoring
        await supabase.functions.invoke('screen-candidate', {
          body: { action: 'complete_screening', application_id: applicationId },
        });

        // Fire notification emails (fire-and-forget)
        supabase.functions.invoke('screening-notifications', {
          body: { action: 'candidate_confirmation', application_id: applicationId },
        }).catch((e: any) => console.error('Candidate notification failed:', e));

        supabase.functions.invoke('screening-notifications', {
          body: { action: 'recruiter_new_application', application_id: applicationId },
        }).catch((e: any) => console.error('Recruiter notification failed:', e));

        setTimeout(() => onComplete(), 2000);
      } else {
        // Next question
        setCurrentIndex(nextIndex);
        setQuestionStartTime(Date.now());
        setMessages((prev) => [...prev, { role: 'assistant', content: questions[nextIndex].question }]);
      }
    } catch (err) {
      console.error('Error processing answer:', err);
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-foreground font-medium">Preparing your screening questions...</p>
        </div>
      </div>
    );
  }

  const progress = questions.length > 0 ? ((currentIndex + (isSending ? 1 : 0)) / questions.length) * 100 : 0;
  const minLength = 50;
  const charCount = input.length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 bg-card">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">
            Question {Math.min(currentIndex + 1, questions.length)} of {questions.length}
          </span>
          <Progress value={progress} className="w-32 h-2" />
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-md'
                  : 'bg-card border border-border text-foreground rounded-bl-md'
              }`}>
                {msg.content}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-secondary-foreground" />
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Input */}
      {currentIndex < questions.length && (
        <div className="border-t border-border px-4 py-4 bg-card">
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type your answer..."
                  className="min-h-[60px] max-h-[150px] resize-none pr-16"
                  disabled={isSending}
                />
                <span className={`absolute bottom-2 right-2 text-xs ${charCount >= minLength ? 'text-primary' : 'text-muted-foreground'}`}>
                  {charCount}/{minLength}
                </span>
              </div>
              <Button
                onClick={handleSend}
                disabled={charCount < minLength || isSending}
                size="icon"
                className="h-[60px] w-[60px] shrink-0"
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            {charCount > 0 && charCount < minLength && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Please write at least {minLength} characters ({minLength - charCount} more needed)
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
