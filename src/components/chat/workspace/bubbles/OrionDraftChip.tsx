// Marks an ORION draft as TEXT ONLY: written in the chat, not sent, not
// published, not saved, and with campaign execution disabled. Rendered only
// when the server attached `metadata.orion_draft` (pilot-chat R1.1).
import { PenLine } from 'lucide-react';
import { ORION_DRAFT_CHIP_TEXT, readOrionDraft } from '@/lib/chat/orionDraft';

export default function OrionDraftChip({ metadata }: { metadata: unknown }) {
  const d = readOrionDraft(metadata);
  if (!d) return null;
  return (
    <div
      className="mt-1.5 inline-flex max-w-[720px] flex-wrap items-center gap-1.5 rounded-full border border-sky-200/25 bg-sky-300/10 px-2.5 py-1 text-[12px] text-sky-100"
      data-testid="orion-draft-chip"
      role="note"
    >
      <PenLine className="h-3.5 w-3.5" aria-hidden />
      <span className="font-medium">{d.labels.join(' · ')}</span>
      <span className="text-sky-100/80">— {ORION_DRAFT_CHIP_TEXT}</span>
    </div>
  );
}
