import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { preserveSetupEdits } from '../../src/lib/guidedSetup.ts';

Deno.test('new AI suggestions fill untouched fields without replacing user context', () => {
  const previous = { company: { model: '', name: '' }, buyers: [] as string[], signals: [] as string[] };
  const edited = { company: { model: 'SaaS', name: 'Acme' }, buyers: ['Founder'], signals: [] as string[] };
  const incoming = { company: { model: 'Services', name: 'ACME Inc' }, buyers: ['CFO'], signals: ['Hiring'] };
  assertEquals(preserveSetupEdits(previous, edited, incoming), {
    company: { model: 'SaaS', name: 'Acme' }, buyers: ['Founder'], signals: ['Hiring'],
  });
  assertEquals(incoming.buyers, ['CFO']);
});

Deno.test('explicit deletion survives a regenerated draft', () => {
  assertEquals(preserveSetupEdits({ signals: ['Funding'] }, { signals: [] }, { signals: ['Funding', 'Hiring'] }), { signals: [] });
});

Deno.test('untouched nested context accepts the new draft', () => {
  const previous = { company: { model: '' }, buyers: [] as string[] };
  assertEquals(preserveSetupEdits(previous, structuredClone(previous), { company: { model: 'SaaS' }, buyers: ['Founder'] }), { company: { model: 'SaaS' }, buyers: ['Founder'] });
});
