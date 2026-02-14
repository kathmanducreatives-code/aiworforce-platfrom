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
      <style>body{font-family:sans-serif;padding:2rem;} h1{font-size:1.25rem;} .q{margin:1rem 0;} .context{color:#666;font-size:0.875rem;}</style>
      </head><body>
      <h1>Interview Questions</h1>
      ${items.map((q, i) => `<div class="q"><strong>${i + 1}. ${q.question}</strong><p class="context">${q.context || q.why || ""}</p></div>`).join("")}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">No interview questions generated yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleCopyAll}>
          <Copy className="h-4 w-4 mr-1" /> Copy All
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-1" /> Print
        </Button>
      </div>
      <div className="space-y-3">
        {items.map((q: any, i: number) => (
          <div key={i} className="border border-border rounded-lg p-3">
            <p className="font-medium text-foreground text-sm">{i + 1}. {q.question}</p>
            {(q.context || q.why) && (
              <p className="text-xs text-muted-foreground mt-1 italic">Why: {q.context || q.why}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default InterviewQuestionsPanel;
