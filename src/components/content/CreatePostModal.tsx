import { FileText, Link2, Package, User, Brain, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { sendAgentCommand } from "@/lib/agentCommand";

const dispatchChat = (text: string) =>
  void sendAgentCommand(text, { success: "Sent to Pilot", action_source: "content_action" });

const SOURCES = [
  { key: "signal", icon: FileText, label: "From saved signal", brief: "Scribe, draft a LinkedIn post from a saved signal — draft only." },
  { key: "product", icon: Package, label: "From product update", brief: "Scribe, draft a LinkedIn post about this week's product update — draft only." },
  { key: "founder", icon: User, label: "From founder thought", brief: "Scribe, draft a founder POV post — ask me for the thought first, draft only." },
  { key: "brain", icon: Brain, label: "From company brain", brief: "Scribe, draft a LinkedIn post grounded in our company brain — draft only." },
  { key: "url", icon: Link2, label: "From pasted URL", brief: "Scribe, draft a LinkedIn post from a URL — ask me for the URL, draft only." },
];

export default function CreatePostModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="create-post-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-[20px] font-semibold text-foreground">Create post</h3>
                <p className="text-[14px] text-muted-foreground mt-1">Pick a source. Scribe will prepare a brief — nothing publishes.</p>
              </div>
              <button onClick={onClose} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2">
              {SOURCES.map(({ key, icon: Icon, label, brief }) => (
                <motion.button
                  key={key}
                  onClick={() => { dispatchChat(brief); onClose(); }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border/70 bg-background/40 hover:border-primary/40 hover:bg-background/70 text-left transition active:scale-[0.98]"
                >
                  <Icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-[15px] font-medium text-foreground">{label}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
