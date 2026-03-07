import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/* ================================================================
   ALL CSS — injected via <style> to support pseudo-elements,
   keyframes, hover states, and complex selectors that can't be
   done with inline styles.
   ================================================================ */
const STYLES = `
/* ─── OUTER SECTION ───────────────────────────────── */
.journey-section {
  position: relative;
  background-color: #04060d;
  background-image: radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: 28px 28px;
}

/* ─── INTRO (not sticky) ──────────────────────────── */
.journey-intro {
  text-align: center;
  padding: 120px 40px 100px;
  position: relative;
  z-index: 5;
}

.intro-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #22c55e;
  background: rgba(34,197,94,0.08);
  border: 1px solid rgba(34,197,94,0.2);
  padding: 7px 18px;
  border-radius: 100px;
  margin-bottom: 32px;
}

.intro-label::before {
  content: '◆';
  font-size: 8px;
}

.intro-heading {
  font-size: clamp(44px, 6vw, 72px);
  font-weight: 800;
  line-height: 1.0;
  letter-spacing: -0.025em;
  margin-bottom: 24px;
}

.intro-heading .g1 { color: #fff; }
.intro-heading .g2 {
  background: linear-gradient(90deg, #00C853, #2dd4bf);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.intro-sub {
  font-size: 17px;
  color: rgba(255,255,255,0.42);
  font-weight: 300;
  max-width: 520px;
  margin: 0 auto;
  line-height: 1.65;
}

/* ─── STICKY CARD STACK ───────────────────────────── */
.journey-cards {
  position: relative;
  height: calc(4 * 100vh + 600px);
}

.slot {
  position: sticky;
  top: 80px;
  height: calc(100vh - 80px);
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-perspective: 1000px;
  perspective: 1000px;
  -webkit-perspective-origin: 50% 40%;
  perspective-origin: 50% 40%;
}
.slot-1 { z-index: 10; }
.slot-2 { z-index: 20; }
.slot-3 { z-index: 30; }
.slot-4 { z-index: 40; }

/* ─── THE CARD ────────────────────────────────────── */
.journey-card {
  width: 95%;
  max-width: 1240px;
  height: 580px;
  border-radius: 24px;
  border: 1px solid rgba(255,255,255,0.06);
  display: grid;
  grid-template-columns: 40% 55%;
  gap: 5%;
  overflow: hidden;
  position: relative;
  background: #141414;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 24px 48px rgba(0,0,0,0.4);
  -webkit-transform-style: preserve-3d;
  transform-style: preserve-3d;
  -webkit-transform-origin: center bottom;
  transform-origin: center bottom;
  will-change: transform, opacity;
  transition: none; /* GSAP controls transitions */
}

/* ─── RIM-LIGHT SWEEP ──────────────────────────────── */
.journey-card::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 24px;
  background: linear-gradient(
    130deg,
    transparent 0%, transparent 40%,
    rgba(255,255,255,0.12) 50%,
    transparent 60%, transparent 100%
  );
  background-size: 300% 100%;
  background-position: 200% 0;
  pointer-events: none;
  z-index: 20;
  opacity: 0;
  transition: opacity 0.3s ease;
}
.journey-card.rim-active::after {
  opacity: 1;
  animation: rim-sweep 1.6s cubic-bezier(0.25, 1, 0.5, 1) forwards;
}
@keyframes rim-sweep {
  from { background-position: 200% 0; }
  to   { background-position: -100% 0; }
}

/* ─── HOVER TILT ───────────────────────────────────── */
.journey-card.jc-in-view {
  transition: transform 0.3s cubic-bezier(0.25,1,0.5,1), box-shadow 0.3s ease;
}
.journey-card.jc-in-view:hover {
  transform: rotateX(2deg) rotateY(-2deg) scale(1.015) !important;
  box-shadow: 0 6px 20px rgba(0,0,0,0.35), 0 32px 56px rgba(0,0,0,0.5);
}

/* ─── IDLE FLOAT ───────────────────────────────────── */
@keyframes idle-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-4px); }
}
.journey-card.jc-floating {
  animation: idle-float 3s ease-in-out infinite;
}

/* ─── INNER PANEL PARALLAX ─────────────────────────── */
.card-right .ui-panel {
  will-change: transform;
}

/* ─── REDUCED MOTION ───────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .journey-card,
  .journey-card.jc-floating,
  .journey-card::after,
  .card-right .ui-panel { animation: none !important; transition: opacity 0.4s ease !important; }
}

.journey-card-1 {
  background: #0d1117;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(99,102,241,0.22) 0%, transparent 55%);
}
.journey-card-1 { border-top: 2px solid rgba(6,182,212,0.3); }
.journey-card-2 { border-top: 2px solid rgba(34,197,94,0.3); }
.journey-card-3 { border-top: 2px solid rgba(168,85,247,0.3); }
.journey-card-4 { border-top: 2px solid rgba(6,182,212,0.3); }
.journey-card-3 {
  background: #0d1117;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(236,72,153,0.20) 0%, transparent 55%);
}
.journey-card-4 {
  background: #0d1117;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(245,158,11,0.22) 0%, transparent 55%);
}

/* ─── LEFT COLUMN ─────────────────────────────────── */
.card-left {
  padding: 52px 44px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-right: 1px solid rgba(255,255,255,0.05);
}

.step-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}

.step-badge {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  border-radius: 6px;
}
.badge-indigo { background: rgba(99,102,241,0.15); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.3); }
.badge-teal   { background: rgba(20,184,166,0.15);  color: #5eead4; border: 1px solid rgba(20,184,166,0.3); }
.badge-rose   { background: rgba(236,72,153,0.15);  color: #fda4af; border: 1px solid rgba(236,72,153,0.3); }
.badge-amber  { background: rgba(245,158,11,0.15);  color: #fcd34d; border: 1px solid rgba(245,158,11,0.3); }

.step-icon { font-size: 28px; line-height: 1; }

.card-headline {
  font-size: clamp(24px, 3vw, 32px);
  font-weight: 900;
  line-height: 1.0;
  letter-spacing: -0.04em;
  color: #fff;
  margin-bottom: 14px;
}

.card-desc {
  font-size: 15px;
  color: rgba(255,255,255,0.6);
  line-height: 1.6;
  font-weight: 400;
  margin-bottom: 28px;
}

.bullets {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bullet {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 13px;
  color: rgba(255,255,255,0.62);
  line-height: 1.5;
}

.bullet-check {
  flex-shrink: 0;
  margin-top: 1px;
  font-size: 12px;
}
.check-indigo { color: #818cf8; }
.check-teal   { color: #2dd4bf; }
.check-rose   { color: #fb7185; }
.check-amber  { color: #fbbf24; }

/* ─── RIGHT COLUMN ────────────────────────────────── */
.card-right {
  padding: 28px;
  display: flex;
  align-items: stretch;
  position: relative;
  overflow: hidden;
}

.ui-panel {
  flex: 1;
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px;
  padding: 24px;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

/* ─── CARD 1: AVATAR CLOUD ────────────────────────── */
.avatar-cloud {
  position: relative;
  flex: 1;
}

.av {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.av-circle {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  border: 2px solid;
}

.av-label {
  font-size: 9px;
  color: rgba(255,255,255,0.35);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.av-dim .av-circle { opacity: 0.28; }
.av-dim .av-label  { opacity: 0.2; }

.profile-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 210px;
  background: rgba(99,102,241,0.08);
  border: 1px solid rgba(99,102,241,0.45);
  border-radius: 16px;
  padding: 20px;
  text-align: center;
  box-shadow: 0 0 40px rgba(99,102,241,0.2);
}

.profile-av {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: #4f46e5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 800;
  margin: 0 auto 12px;
  border: 2px solid rgba(99,102,241,0.6);
}

.profile-name {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 3px;
}

.profile-title {
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  margin-bottom: 12px;
}

.available-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(34,197,94,0.12);
  border: 1px solid rgba(34,197,94,0.3);
  color: #4ade80;
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 100px;
}

.available-pill::before {
  content: '';
  width: 6px; height: 6px;
  background: #22c55e;
  border-radius: 50%;
  animation: pulse-dot 2s ease infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.7); }
}

/* ─── CARD 2: SCORECARD ───────────────────────────── */
.scorecard-header {
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(20,184,166,0.8);
  margin-bottom: 6px;
}

.scorecard-line {
  height: 1px;
  background: rgba(20,184,166,0.3);
  margin-bottom: 24px;
}

.skill-row {
  margin-bottom: 18px;
}

.skill-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 7px;
}

.skill-name {
  font-size: 13px;
  color: rgba(255,255,255,0.75);
}

.skill-score {
  font-size: 13px;
  font-weight: 700;
  color: #2dd4bf;
}
.skill-score.indigo { color: #818cf8; }

.bar-track {
  height: 6px;
  background: rgba(255,255,255,0.07);
  border-radius: 3px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
}
.fill-teal  { background: linear-gradient(90deg, #0d9488, #2dd4bf); }
.fill-indigo { background: linear-gradient(90deg, #4f46e5, #818cf8); }

.fit-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  background: rgba(20,184,166,0.08);
  border: 1px solid rgba(20,184,166,0.35);
  border-radius: 100px;
  padding: 11px 20px;
  font-size: 13px;
  color: #2dd4bf;
  font-weight: 500;
  animation: glow-teal 2.5s ease infinite;
}

@keyframes glow-teal {
  0%, 100% { box-shadow: 0 0 0px rgba(20,184,166,0); }
  50% { box-shadow: 0 0 22px rgba(20,184,166,0.35); }
}

/* ─── CARD 3: INTERVIEW ───────────────────────────── */
.interview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 18px;
}

.ih-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ih-av {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: #0d9488;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.ih-name { font-size: 13px; font-weight: 600; color: #fff; }
.ih-role { font-size: 11px; color: rgba(255,255,255,0.4); }

.recording-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(236,72,153,0.1);
  border: 1px solid rgba(236,72,153,0.3);
  color: #fb7185;
  font-size: 10px;
  padding: 5px 11px;
  border-radius: 100px;
  white-space: nowrap;
}

.recording-pill::before {
  content: '';
  width: 6px; height: 6px;
  background: #f43f5e;
  border-radius: 50%;
  animation: pulse-dot 1.2s ease infinite;
}

.questions-label {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(236,72,153,0.7);
  margin-bottom: 12px;
}

.q-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.q-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.q-num {
  font-size: 10px;
  color: rgba(236,72,153,0.7);
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 1px;
  letter-spacing: 0.05em;
}

.q-bar {
  width: 2px;
  height: 18px;
  background: rgba(236,72,153,0.4);
  border-radius: 1px;
  flex-shrink: 0;
  margin-top: 1px;
}

.q-text {
  font-size: 12.5px;
  color: rgba(255,255,255,0.7);
  line-height: 1.5;
}

.stats-row {
  display: flex;
  gap: 7px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.stat-pill {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 100px;
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  padding: 5px 13px;
}

/* ─── CARD 4: FEEDBACK ────────────────────────────── */
.feedback-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 16px;
}

.fh-av {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: #92400e;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  flex-shrink: 0;
}

.avail-pill-sm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.25);
  color: #4ade80;
  font-size: 10px;
  padding: 4px 10px;
  border-radius: 100px;
}
.avail-pill-sm::before {
  content: '';
  width: 5px; height: 5px;
  background: #22c55e;
  border-radius: 50%;
}

.reviewer-block {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 16px;
}

.reviewer-top {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 10px;
}

.reviewer-av {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: #78350f;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  flex-shrink: 0;
}

.reviewer-name { font-size: 12px; font-weight: 600; color: #fff; }
.reviewer-role { font-size: 10px; color: rgba(255,255,255,0.38); }

.reviewer-quote {
  font-size: 12px;
  color: rgba(255,255,255,0.62);
  font-style: italic;
  line-height: 1.55;
}

.stars-row {
  font-size: 22px;
  letter-spacing: 4px;
  color: #fbbf24;
  margin-bottom: 14px;
}

.rating-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.big-rating {
  font-size: 38px;
  font-weight: 800;
  color: #fbbf24;
  line-height: 1;
}

.top-badge {
  background: rgba(245,158,11,0.1);
  border: 1px solid rgba(245,158,11,0.3);
  color: #fcd34d;
  font-size: 11px;
  padding: 5px 12px;
  border-radius: 100px;
}

.request-btn {
  width: 100%;
  padding: 12px;
  background: transparent;
  border: 1px solid rgba(245,158,11,0.5);
  color: #fbbf24;
  border-radius: 100px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 0.02em;
  animation: glow-amber 1.5s ease infinite;
  transition: background 0.2s;
}

.request-btn:hover {
  background: rgba(245,158,11,0.08);
}

@keyframes glow-amber {
  0%, 100% { box-shadow: 0 0 8px rgba(245,158,11,0.25); }
  50% { box-shadow: 0 0 32px rgba(245,158,11,0.75); }
}

/* ─── NEW: MARKETPLACE PANELS ─────────────────────── */
.mp-label {
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  margin-bottom: 16px;
}
.mp-label-green { color: rgba(34,197,94,0.8); }
.mp-label-teal  { color: rgba(20,184,166,0.8); }
.mp-label-rose  { color: rgba(168,85,247,0.7); }

.mp-line {
  height: 1px;
  background: rgba(255,255,255,0.06);
  margin-bottom: 16px;
}

/* Expert row — used in search results & dashboard */
.expert-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.expert-row:last-of-type { border-bottom: none; }

.expert-av {
  width: 36px; height: 36px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  flex-shrink: 0;
  border: 1.5px solid;
}

.expert-info { flex: 1; min-width: 0; }
.expert-name { font-size: 12.5px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.expert-title { font-size: 10.5px; color: rgba(255,255,255,0.38); }

.pill-available {
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.3);
  color: #4ade80; font-size: 10px; padding: 3px 9px; border-radius: 100px;
  white-space: nowrap; flex-shrink: 0;
}
.pill-available::before {
  content: ''; width: 5px; height: 5px;
  background: #22c55e; border-radius: 50%;
}

.btn-outline-teal {
  display: inline-flex; align-items: center; gap: 4px;
  background: transparent; border: 1px solid rgba(6,182,212,0.4);
  color: #22d3ee; font-size: 10px; padding: 4px 10px;
  border-radius: 100px; cursor: pointer; white-space: nowrap;
  transition: background 0.2s;
  flex-shrink: 0;
}
.btn-outline-teal:hover { background: rgba(6,182,212,0.08); }

.btn-green-full {
  width: 100%; padding: 11px;
  background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.35);
  color: #22c55e; border-radius: 100px;
  font-size: 12.5px; font-weight: 500; cursor: pointer;
  margin-top: 14px; transition: background 0.2s;
  animation: glow-green 2s ease infinite;
}
.btn-green-full:hover { background: rgba(34,197,94,0.18); }

@keyframes glow-green {
  0%, 100% { box-shadow: 0 0 0 rgba(34,197,94,0); }
  50% { box-shadow: 0 0 20px rgba(34,197,94,0.3); }
}

/* Onboarding stepper */
.stepper {
  display: flex; align-items: center; gap: 0; margin: 10px 0 16px;
}
.step-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: rgba(255,255,255,0.15); flex-shrink: 0;
}
.step-dot.active { background: #22c55e; }
.step-dot.active-glow { background: #22c55e; box-shadow: 0 0 8px #22c55e; animation: pulse-dot 2s ease infinite; }
.step-connector {
  flex: 1; height: 2px; background: rgba(255,255,255,0.08);
  margin: 0 4px;
}
.step-connector.done { background: rgba(34,197,94,0.4); }
.step-labels {
  display: flex;
  justify-content: space-between;
  width: 100%;
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  letter-spacing: 0.02em;
  padding: 0 4px;
}
.step-labels span {
  flex: 1;
  text-align: center;
}
.step-labels span:first-child { text-align: left; }
.step-labels span:last-child { text-align: right; }

/* Info grid rows */
.info-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 9px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-size: 12px;
}
.info-label { color: rgba(255,255,255,0.4); }
.info-value { color: rgba(255,255,255,0.8); font-weight: 500; }

/* Stats mini row */
.mini-stats {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  margin-bottom: 14px;
}
.mini-stat {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; padding: 10px 12px; text-align: center;
}
.mini-stat-val { font-size: 20px; font-weight: 800; color: #fff; line-height: 1; margin-bottom: 2px; }
.mini-stat-label { font-size: 10px; color: rgba(255,255,255,0.35); }

/* Paid pill */
.pill-paid {
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(34,197,94,0.15); border: 1px solid #22c55e;
  color: #22c55e; font-size: 10px; padding: 3px 9px; border-radius: 100px;
  white-space: nowrap; flex-shrink: 0; font-weight: 500;
}

/* Star rating inline */
.stars-inline {
  color: #fbbf24; font-size: 13px; letter-spacing: 2px; flex-shrink: 0;
}

.btn-outline-full {
  width: 100%; padding: 11px;
  background: transparent; border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.6); border-radius: 100px;
  font-size: 12.5px; font-weight: 500; cursor: pointer;
  margin-top: 14px; transition: background 0.2s, border-color 0.2s;
}
.btn-outline-full:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.2); }

/* Green fill bar variant */
.fill-green { background: linear-gradient(90deg, #15803d, #22c55e); }
/* Purple fill bar variant */
.fill-purple { background: linear-gradient(90deg, #7e22ce, #a855f7); }

/* Card background tweaks for marketplace */
.journey-card-1 {
  background: #141414;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(6,182,212,0.18) 0%, transparent 55%);
  border-top: 1px solid rgba(6,182,212,0.3);
}
.journey-card-2 {
  background: #141414;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(34,197,94,0.18) 0%, transparent 55%);
  border-top: 1px solid rgba(34,197,94,0.3);
}
.journey-card-3 {
  background: #141414;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(168,85,247,0.16) 0%, transparent 55%);
  border-top: 1px solid rgba(168,85,247,0.3);
}
.journey-card-4 {
  background: #141414;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(6,182,212,0.14) 0%, rgba(168,85,247,0.08) 45%, transparent 65%);
  border-top: 1px solid rgba(6,182,212,0.3);
}

/* Section label in card-left */
.section-label {
  font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
  color: #22c55e; margin-bottom: 12px;
  display: flex; align-items: center; gap: 6px;
}
.section-label::before { content: '◆'; font-size: 7px; }

/* Badge styles for marketplace (green-only) */
.badge-green { background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
.badge-purple { background: rgba(168,85,247,0.12); color: #d8b4fe; border: 1px solid rgba(168,85,247,0.3); }
.check-green { color: #22c55e; }
`;

/* ================================================================
   COMPONENT
   ================================================================ */
export const ExpertJourney = () => {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    /* Respect reduced-motion preference */
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>('.journey-card');
      const slots = gsap.utils.toArray<HTMLElement>('.slot');

      cards.forEach((card, i) => {
        const slot = slots[i];
        const isLast = i === cards.length - 1;
        const panel = card.querySelector<HTMLElement>('.ui-panel');

        /* ── 1. 3D ENTRANCE ANIMATION ────────────────────── */
        /* Initial hidden state */
        gsap.set(card, {
          rotateX: prefersReduced ? 0 : 8,
          y: prefersReduced ? 0 : 60,
          scale: prefersReduced ? 1 : 0.96,
          opacity: prefersReduced ? 1 : 0,
          transformOrigin: 'center bottom',
        });

        /* Scroll into view → animate to flat, visible */
        ScrollTrigger.create({
          trigger: slot,
          start: 'top 85%', /* Trigger earlier as requested */
          onEnter: () => {
            gsap.to(card, {
              rotateX: 0,
              y: 0,
              scale: 1,
              opacity: 1,
              duration: prefersReduced ? 0.3 : 0.7,
              ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
              delay: i * 0.1,
              onComplete: () => {
                card.classList.add('jc-in-view');
                /* Start idle float after entrance */
                if (!prefersReduced) {
                  card.classList.add('jc-floating');
                }
              }
            });
          },
          once: true,
        });

        /* ── 2. OUTGOING CARD RECEDE (scrub) ──────────────── */
        if (!isLast && !prefersReduced) {
          ScrollTrigger.create({
            trigger: slot,
            start: 'top top',
            end: 'bottom top',
            scrub: 1,
            onUpdate: (self) => {
              const p = self.progress;
              /* Remove idle float while scrubbing */
              if (p > 0.05) card.classList.remove('jc-floating', 'jc-in-view');
              const rX = gsap.utils.clamp(-13, 0, -13 * p);
              const sc = gsap.utils.clamp(0.90, 1, 1 - 0.10 * p);
              const br = gsap.utils.clamp(0.45, 1, 1 - 0.55 * p);
              const bl = gsap.utils.clamp(0, 5, 5 * p);
              gsap.set(card, {
                rotateX: rX,
                scale: sc,
                filter: `brightness(${br}) blur(${bl}px)`,
              });
            },
          });
        }

        /* ── 3. RIM-LIGHT SHIMMER ─────────────────────────── */
        if (!prefersReduced) {
          ScrollTrigger.create({
            trigger: slot,
            start: 'top 55%',
            onEnter: () => {
              card.classList.remove('rim-active');
              void card.offsetWidth; /* reflow */
              card.classList.add('rim-active');
              setTimeout(() => card.classList.remove('rim-active'), 1800);
            },
          });
        }

        /* ── 4. INNER PANEL PARALLAX ──────────────────────── */
        if (panel && !prefersReduced) {
          gsap.to(panel, {
            y: -24,
            ease: 'none',
            scrollTrigger: {
              trigger: slot,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.5,
            },
          });
        }
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <>
      <style>{STYLES}</style>

      <section className="journey-section" ref={sectionRef}>
        {/* ── Intro ──────────────────────────────────────── */}
        <div className="journey-intro">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/5 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="font-mono text-[11px] uppercase tracking-[2px] text-emerald-400 font-semibold mt-px">EXPERT MARKETPLACE</span>
          </div>
          <h2 className="font-display font-black text-[clamp(2.5rem,6vw,5.5rem)] leading-[0.95] tracking-[-0.06em] mb-10">
            <span className="g1 block">HIRE THE INTERVIEWER.</span>
            <span className="g2 block text-emerald-500">SKIP THE AGENCY.</span>
          </h2>
          <p className="text-white/60 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
            Stop paying €15,000 upfront. Recruit active world-class engineers from Google, Meta, and OpenAI to interview your candidates for <strong className="text-white">€85/session</strong>. Pay only for what you use.
          </p>
        </div>

        {/* ── THE CARD STACK CONTAINER ─────────────────── */}
        <div className="journey-cards">

          {/* ── SLIDE 1 — EXPERT SOURCING ──────────────── */}
          <div className="slot slot-1">
            <div className="journey-card journey-card-1">
              <div className="card-left">
                <div className="step-row">
                  <span className="step-badge badge-green">01</span>
                  <span className="step-icon">
                    <svg className="w-6 h-6 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </span>
                </div>
                <div className="section-label">Expert Sourcing</div>
                <h3 className="card-headline">Find Real Interviewers.<br />Already in the Field.</h3>
                <p className="card-desc">
                  We scrape LinkedIn and professional networks to surface active practitioners —
                  Senior Engineers, Product Leaders, and Domain Specialists currently employed at
                  top companies — who are open to part-time interview work.
                </p>
                <div className="bullets">
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Sourced from LinkedIn, GitHub, and verified networks</div>
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Filtered by role, seniority, and domain expertise</div>
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Only active professionals, not career coaches</div>
                </div>
              </div>
              <div className="card-right">
                <div className="ui-panel">
                  <div className="mp-label mp-label-teal">Expert Search</div>
                  <div className="mp-line" />
                  <div className="expert-row">
                    <div className="expert-av" style={{ background: 'rgba(20,184,166,0.2)', color: '#5eead4', borderColor: 'rgba(20,184,166,0.4)' }}>AR</div>
                    <div className="expert-info"><div className="expert-name">Alex R. — Staff Engineer, Meta</div></div>
                    <span className="pill-available">Available</span>
                    <button className="btn-outline-teal">Add to Pipeline →</button>
                  </div>
                  <div className="expert-row">
                    <div className="expert-av" style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80', borderColor: 'rgba(34,197,94,0.4)' }}>NK</div>
                    <div className="expert-info"><div className="expert-name">Nisha K. — Principal PM, Stripe</div></div>
                    <span className="pill-available">Available</span>
                    <button className="btn-outline-teal">Add to Pipeline →</button>
                  </div>
                  <div className="expert-row">
                    <div className="expert-av" style={{ background: 'rgba(168,85,247,0.2)', color: '#d8b4fe', borderColor: 'rgba(168,85,247,0.4)' }}>JM</div>
                    <div className="expert-info"><div className="expert-name">James M. — Sr DevOps, Datadog</div></div>
                    <span className="pill-available">Available</span>
                    <button className="btn-outline-teal">Add to Pipeline →</button>
                  </div>
                  <button className="btn-green-full">Generate Outreach →</button>
                </div>
              </div>
            </div>
          </div>

          {/* ── SLIDE 2 — INSTANT ONBOARDING ───────────── */}
          <div className="slot slot-2">
            <div className="journey-card journey-card-2">
              <div className="card-left">
                <div className="step-row">
                  <span className="step-badge badge-green">02</span>
                  <span className="step-icon">
                    <svg className="w-6 h-6 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </span>
                </div>
                <div className="section-label">Instant Onboarding</div>
                <h3 className="card-headline">One Click to Onboard.<br />They're Your Recruiter Now.</h3>
                <p className="card-desc">
                  Once an expert accepts your invite, ScreeningPilot onboards them automatically.
                  They get access to your job briefs, candidate pipeline, and structured rubrics —
                  no back-and-forth setup, no paperwork.
                </p>
                <div className="bullets">
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Automated onboarding flow, zero manual setup</div>
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Expert gets role brief, rubric, and calendar access instantly</div>
                  <div className="bullet"><span className="bullet-check check-green">✓</span>You stay in control — approve, pause, or replace any time</div>
                </div>
              </div>
              <div className="card-right">
                <div className="ui-panel">
                  <div className="mp-label mp-label-green">Onboarding Status</div>
                  <div className="mp-line" />
                  <div className="expert-row" style={{ borderBottom: 'none', paddingBottom: 4 }}>
                    <div className="expert-av" style={{ background: 'rgba(20,184,166,0.2)', color: '#5eead4', borderColor: 'rgba(20,184,166,0.4)' }}>AR</div>
                    <div className="expert-info">
                      <div className="expert-name">Alex R.</div>
                      <div className="expert-title">Staff Engineer, Meta</div>
                    </div>
                  </div>
                  <div className="stepper">
                    <div className="step-dot active" />
                    <div className="step-connector done" />
                    <div className="step-dot active" />
                    <div className="step-connector done" />
                    <div className="step-dot active-glow" />
                  </div>
                  <div className="step-labels">
                    <span>Invite Sent</span>
                    <span>Profile Verified</span>
                    <span>Active</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Role Brief</span>
                    <span className="info-value">Senior DevOps Engineer — Remote</span>
                  </div>
                  <div className="info-row" style={{ borderBottom: 'none' }}>
                    <span className="info-label">Rubric Assigned</span>
                    <span className="info-value">Systems Design + Behavioral</span>
                  </div>
                  <button className="btn-green-full">Start Scheduling →</button>
                </div>
              </div>
            </div>
          </div>

          {/* ── SLIDE 3 — LIVE INTERVIEWS ──────────────── */}
          <div className="slot slot-3">
            <div className="journey-card journey-card-3">
              <div className="card-left">
                <div className="step-row">
                  <span className="step-badge badge-purple">03</span>
                  <span className="step-icon">
                    <svg className="w-6 h-6 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </span>
                </div>
                <div className="section-label">Live Interviews</div>
                <h3 className="card-headline">Structured Interviews.<br />Scored as They Happen.</h3>
                <p className="card-desc">
                  The expert conducts the video interview directly through ScreeningPilot.
                  Every session is recorded, transcribed, and auto-scored against your rubric
                  in real time. No notes on napkins — everything lives in your dashboard.
                </p>
                <div className="bullets">
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Video recorded and transcribed automatically</div>
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Expert scores each rubric dimension during the call</div>
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Confidence and communication analysis included</div>
                </div>
              </div>
              <div className="card-right">
                <div className="ui-panel">
                  <div className="interview-header">
                    <div className="ih-left">
                      <div className="ih-av" style={{ background: '#7e22ce' }}>SK</div>
                      <div>
                        <div className="ih-name">Sarah K. — Interviewer</div>
                        <div className="ih-role">Principal Engineer, Google</div>
                      </div>
                    </div>
                    <div className="recording-pill">Recording Saved &amp; Analyzed</div>
                  </div>
                  <div className="mp-label mp-label-rose">Live Scorecard</div>
                  <div className="skill-row">
                    <div className="skill-top">
                      <span className="skill-name">Technical Depth</span>
                      <span className="skill-score" style={{ color: '#2dd4bf' }}>87/100</span>
                    </div>
                    <div className="bar-track"><div className="bar-fill fill-green" style={{ width: '87%' }} /></div>
                  </div>
                  <div className="skill-row">
                    <div className="skill-top">
                      <span className="skill-name">Communication</span>
                      <span className="skill-score" style={{ color: '#2dd4bf' }}>92/100</span>
                    </div>
                    <div className="bar-track"><div className="bar-fill fill-green" style={{ width: '92%' }} /></div>
                  </div>
                  <div className="skill-row">
                    <div className="skill-top">
                      <span className="skill-name">Problem Solving</span>
                      <span className="skill-score" style={{ color: '#2dd4bf' }}>84/100</span>
                    </div>
                    <div className="bar-track"><div className="bar-fill fill-green" style={{ width: '84%' }} /></div>
                  </div>
                  <div className="skill-row">
                    <div className="skill-top">
                      <span className="skill-name">Culture Fit</span>
                      <span className="skill-score indigo" style={{ color: '#a855f7' }}>71/100</span>
                    </div>
                    <div className="bar-track"><div className="bar-fill fill-purple" style={{ width: '71%' }} /></div>
                  </div>
                  <div className="stats-row">
                    <span className="stat-pill">Duration: 38 min</span>
                    <span className="stat-pill">Transcript: Ready</span>
                    <span className="stat-pill">Confidence: High</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── SLIDE 4 — PAYOUTS & OVERSIGHT ──────────── */}
          <div className="slot slot-4">
            <div className="journey-card journey-card-4">
              <div className="card-left">
                <div className="step-row">
                  <span className="step-badge badge-green">04</span>
                  <span className="step-icon">
                    <svg className="w-6 h-6 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h2a2 2 0 002-2zm9-10v10a2 2 0 01-2 2h-2a2 2 0 01-2-2V9a2 2 0 012-2h2a2 2 0 012 2z" />
                    </svg>
                  </span>
                </div>
                <div className="section-label">Payouts &amp; Oversight</div>
                <h3 className="card-headline">Experts Earn Per Interview.<br />You See Everything.</h3>
                <p className="card-desc text-white/60">
                  Experts are paid automatically per completed interview through the platform —
                  no invoices, no chasing. Your dashboard shows every session, score, and payout
                  in one place.
                </p>
                <div className="bullets">
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Per-interview payouts handled by ScreeningPilot</div>
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Full audit trail: recordings, scores, and feedback</div>
                  <div className="bullet"><span className="bullet-check check-green">✓</span>Dispute resolution and rating system built in</div>
                </div>
              </div>
              <div className="card-right">
                <div className="ui-panel">
                  <div className="mp-label mp-label-teal">Interviewer Dashboard</div>
                  <div className="mp-line" />
                  <div className="mini-stats">
                    <div className="mini-stat">
                      <div className="mini-stat-val">12</div>
                      <div className="mini-stat-label">Interviews Completed</div>
                    </div>
                    <div className="mini-stat">
                      <div className="mini-stat-val">88<span style={{ fontSize: 13, opacity: 0.5 }}>/100</span></div>
                      <div className="mini-stat-label">Avg Score Given</div>
                    </div>
                  </div>
                  <div className="expert-row" style={{ paddingBottom: 14 }}>
                    <div className="expert-av" style={{ background: 'rgba(20,184,166,0.2)', color: '#5eead4', borderColor: 'rgba(20,184,166,0.4)' }}>AR</div>
                    <div className="expert-info">
                      <div className="expert-name">Alex R. — Staff Eng</div>
                    </div>
                    <span className="stars-inline">★★★★☆</span>
                    <span className="pill-paid">Paid $85</span>
                  </div>
                  <div className="reviewer-block" style={{ marginTop: 2, marginBottom: 8 }}>
                    <div className="reviewer-quote">
                      "Jane delivered a thorough systems review. Will use again."
                    </div>
                  </div>
                  <button className="btn-outline-full">View All Sessions →</button>
                </div>
              </div>
            </div>
          </div>

        </div>{/* /journey-cards */}
      </section>
    </>
  );
};

export default ExpertJourney;
