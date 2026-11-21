// Company Brain V2 (B2.0): the shared, pure assessment and completion modules,
// re-exported for the app so pages import them from src/lib (one copy of the
// logic: supabase/functions/_shared, also used by the edge functions).
export {
  assessCompanyBrain, readProfilePath, SECTION_SPECS,
  type AssessmentConflict, type AssessmentField, type AssessmentSectionKey, type BrainAssessment, type SectionAssessment,
} from '../../../supabase/functions/_shared/companyBrainAssessment.ts';
export {
  acceptSuggestionPatch, buildCompletionPatch, buildCompletionSuggestions,
  type CompletionSuggestion, type CompletionValue, type StoredResearchRun,
} from '../../../supabase/functions/_shared/companyBrainCompletion.ts';
export {
  assessIcpConsistency, type IcpConflict, type IcpResolution,
} from '../../../supabase/functions/_shared/companyBrainIcpConsistency.ts';
export {
  sectionProvenance, type ProvenanceClaim, type ProvenanceRevision, type RevisionSourceKind, type SectionProvenance,
} from '../../../supabase/functions/_shared/companyBrainProvenance.ts';
