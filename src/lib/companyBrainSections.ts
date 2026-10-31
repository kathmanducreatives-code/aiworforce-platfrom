// Section metadata + health derivation for the saved Company Brain page.
//
// Pure helper. Reads the normalized CompanyBrainV2 view model and derives a
// per-section health state used by the premium section cards. No data mutation,
// no backend calls — presentational only. SectionKey mirrors the drawer's edit
// contract so health and edit stay in sync.

import { Brain, Crosshair, Users, Radar, ShieldAlert, Megaphone } from 'lucide-react';
import { deriveHealth, type SectionHealth, type SectionKey } from './companyBrainHealth';

export { deriveHealth, type SectionHealth, type SectionKey };

export interface SectionMeta {
  key: SectionKey;
  /** Short eyebrow shown above the title. */
  eyebrow: string;
  title: string;
  /** One-line explanation of what this section powers. */
  explanation: string;
  icon: typeof Brain;
}

export const SECTION_ORDER: SectionKey[] = [
  'targeting', 'buyers', 'signals', 'company', 'disqualifiers', 'messaging',
];

export const SECTION_META: Record<SectionKey, SectionMeta> = {
  targeting: {
    key: 'targeting',
    eyebrow: 'ICP & targeting',
    title: 'ICP / targeting',
    explanation: 'Defines who counts as a fit worth researching.',
    icon: Crosshair,
  },
  buyers: {
    key: 'buyers',
    eyebrow: 'Buyer personas',
    title: 'Buyer personas',
    explanation: 'The roles you sell to and the pains you solve.',
    icon: Users,
  },
  signals: {
    key: 'signals',
    eyebrow: 'Buying signals',
    title: 'Buying signals',
    explanation: 'What Signal Radar should watch for.',
    icon: Radar,
  },
  company: {
    key: 'company',
    eyebrow: 'Company understanding',
    title: 'Company understanding',
    explanation: 'Who you are and what you do.',
    icon: Brain,
  },
  disqualifiers: {
    key: 'disqualifiers',
    eyebrow: 'Disqualifiers & safety',
    title: 'Disqualifiers & safety',
    explanation: 'Who and what to never target.',
    icon: ShieldAlert,
  },
  messaging: {
    key: 'messaging',
    eyebrow: 'Messaging & positioning',
    title: 'Messaging & positioning',
    explanation: 'How Agentory should sound on your behalf.',
    icon: Megaphone,
  },
};

export const HEALTH_LABEL: Record<SectionHealth, string> = {
  configured: 'Configured',
  'needs-confirmation': 'Needs confirmation',
  'needs-detail': 'Add more detail',
};

export const HEALTH_TONE: Record<SectionHealth, 'emerald' | 'amber' | 'neutral'> = {
  configured: 'emerald',
  'needs-confirmation': 'amber',
  'needs-detail': 'neutral',
};

// ---- Vertical intelligence flow ---------------------------------------------------
//
// The saved page renders five narrative sections in the sequence Agentory uses
// the Brain: target → buyer → moment → qualify → message. Each maps 1:1 to an
// existing drawer SectionKey so edit/save stays unchanged.

export interface FlowSectionMeta {
  number: string;
  drawerKey: SectionKey;
  eyebrow: string;
  title: string;
  question: string;
  explanation: string;
}

export const FLOW_SECTIONS: FlowSectionMeta[] = [
  {
    number: '01',
    drawerKey: 'targeting',
    eyebrow: 'Target Market',
    title: 'Target Market',
    question: 'Which companies are worth researching?',
    explanation: 'The account profile Agentory researches and prioritizes.',
  },
  {
    number: '02',
    drawerKey: 'buyers',
    eyebrow: 'Buyer Profile',
    title: 'Buyer Profile',
    question: 'Who feels the problem and can approve a purchase?',
    explanation: 'The people inside target accounts worth speaking to.',
  },
  {
    number: '03',
    drawerKey: 'signals',
    eyebrow: 'Buying Moments',
    title: 'Buying Moments',
    question: 'What makes an account worth contacting now?',
    explanation: 'Timing signals that make outreach relevant.',
  },
  {
    number: '04',
    drawerKey: 'disqualifiers',
    eyebrow: 'Qualification & Safety',
    title: 'Qualification & Safety',
    question: 'What must be true — and what should immediately disqualify?',
    explanation: 'Guardrails that protect lead quality and brand.',
  },
  {
    number: '05',
    drawerKey: 'messaging',
    eyebrow: 'Messaging Fit',
    title: 'Messaging Fit',
    question: 'How should Agentory explain the value?',
    explanation: 'Voice, positioning, and boundaries for generated content.',
  },
];
