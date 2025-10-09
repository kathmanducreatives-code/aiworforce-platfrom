import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail } from "lucide-react";
import TokenPicker from "./TokenPicker";
import type { EmailStep } from "./EmailStepCard";
import { useRef } from "react";

interface EmailEditorProps {
  step: EmailStep | null;
  onUpdate: (field: 'subject' | 'content', value: string) => void;
}

const EmailEditor = ({ step, onUpdate }: EmailEditorProps) => {
  const subjectRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const insertToken = (token: string, field: 'subject' | 'content') => {
    const ref = field === 'subject' ? subjectRef : contentRef;
    const input = ref.current;
    
    if (!input) return;

    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const currentValue = field === 'subject' ? (step?.subject || '') : (step?.content || '');
    const newValue = currentValue.slice(0, start) + token + currentValue.slice(end);
    
    onUpdate(field, newValue);
    
    // Set cursor position after token
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  if (!step) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent>
          <p className="text-muted-foreground text-center">
            Select a step to edit
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Mail className="h-5 w-5" />
          Email Editor - Step {step.stepNumber}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Subject Line */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="subject" className="font-medium">
              Subject Line
            </Label>
            <TokenPicker onTokenSelect={(token) => insertToken(token, 'subject')} />
          </div>
          <Input
            ref={subjectRef}
            id="subject"
            placeholder="e.g., Exciting AI opportunity at {{companyName}}"
            value={step.subject}
            onChange={(e) => onUpdate('subject', e.target.value)}
            className="font-medium"
          />
        </div>

        {/* Email Body */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="content" className="font-medium">
              Email Content
            </Label>
            <TokenPicker onTokenSelect={(token) => insertToken(token, 'content')} />
          </div>
          <Textarea
            ref={contentRef}
            id="content"
            placeholder={`Hi {{firstName}},

I came across your profile and was impressed by your experience...

Best regards,
{{senderName}}`}
            value={step.content}
            onChange={(e) => onUpdate('content', e.target.value)}
            rows={16}
            className="font-mono text-sm resize-none"
          />
          <p className="text-xs text-muted-foreground">
            {step.content.length} characters
          </p>
        </div>

        {/* Token Guide */}
        <div className="bg-muted/50 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Quick Tokens:</p>
          <div className="flex flex-wrap gap-2">
            {['{{firstName}}', '{{candidateName}}', '{{companyName}}'].map((token) => (
              <button
                key={token}
                onClick={() => insertToken(token, 'content')}
                className="text-xs bg-background border px-2 py-1 rounded hover:bg-accent transition-colors"
              >
                {token}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EmailEditor;
