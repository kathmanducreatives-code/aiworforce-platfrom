import { Button } from "@/components/ui/button";
import { Copy, Printer } from "lucide-react";
import { toast } from "sonner";

interface InterviewQuestionsPanelProps {
  questions: any;
}

const InterviewQuestionsPanel = ({ questions }: InterviewQuestionsPanelProps) => {
  const items: any[] = Array.isArray(questions) ? questions : [];

  const handleCopyAll = () => {
    const text = items.map((q, i) => `${i + 1}. ${q.question}\n   Context: ${q.context || q.why || ""}`).join("\n\n");
    navigator.clipboard.writeText(text);
    toast.success("Questions copied!");
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Interview Questions</title>
      <style>body{font-family:sans-serif;padding:2rem;} h1{font-size:1.25rem;} .q{margin:1.25rem 0;border-left:3px solid #059467;padding-left:1rem;} .context{color:#666;font-size:0.875rem;margin-top:0.25rem;font-style:italic;}</style>
      </head><body>
      <h1>Interview Questions</h1>
      ${items.map((q, i) => `<div class="q"><strong>${i + 1}. ${q.question}</strong><p class="context">${q.context || q.why || ""}</p></div>`).join("")}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl border border-dashed border-border/50 bg-muted/10">
        <p className="text-sm text-muted-foreground">No interview questions generated yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleCopyAll} className="border-border/60 hover:border-primary/40 hover:bg-primary/5 hover:text-primary flex-1 sm:flex-none">
          <Copy className="h-4 w-4 mr-1.5" /> Copy All
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrint} className="border-border/60 hover:border-primary/40 hover:bg-primary/5 hover:text-primary flex-1 sm:flex-none">
          <Printer className="h-4 w-4 mr-1.5" /> Print
        </Button>
      </div>
      <div className="space-y-3">
        {items.map((q: any, i: number) => (
          <div key={i} className="relative rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden hover:border-primary/30 transition-colors">
            {/* Left gradient accent bar */}
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary to-primary/30" />
            <div className="pl-4 pr-4 py-4">
              <div className="flex items-start gap-3">
                {/* Number badge */}
                <div className="h-6 w-6 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm leading-snug">{q.question}</p>
                  {(q.context || q.why) && (
                    <p className="text-xs text-muted-foreground mt-1.5 italic bg-muted/30 rounded-md px-2.5 py-1.5 border border-border/30">
                      💡 {q.context || q.why}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InterviewQuestionsPanel;
