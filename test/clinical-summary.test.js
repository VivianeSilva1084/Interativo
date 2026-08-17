import { describe, it, expect } from 'vitest';
import { buildClinicalSummary } from '../src/lib/clinical-summary.js';

describe('buildClinicalSummary', () => {
  it('falls back to the no-data message when nothing is passed', () => {
    const text = buildClinicalSummary({}, 'pt');
    expect(text).toBe('A criança ainda tem poucas sessões registradas para gerar uma análise completa.');
  });

  it('uses the profile name once one exists, and escapes it (rendered as innerHTML by both dashboards)', () => {
    const text = buildClinicalSummary({ profile: { name: '<b>Zeca</b>' }, adherence: [{ taxa_adesao_pct: 90 }] }, 'pt');
    expect(text).toContain('&lt;b&gt;Zeca&lt;/b&gt;');
    expect(text).not.toContain('<b>Zeca</b>');
  });

  it('picks the adherence tier by the 80/50 thresholds', () => {
    const detail = (pct) => ({ profile: { name: 'Ana' }, adherence: [{ taxa_adesao_pct: pct }] });
    expect(buildClinicalSummary(detail(90), 'pt')).toContain('manteve uma frequência excelente');
    expect(buildClinicalSummary(detail(60), 'pt')).toContain('jogou de forma irregular');
    expect(buildClinicalSummary(detail(20), 'pt')).toContain('frequência de uso foi baixa');
  });

  it('compares the two most recent weeks of the first game with data for the focus line', () => {
    const improved = buildClinicalSummary({
      focusEvolution: [{ game_key: 'cacaalvo', avg_duration_seconds: 120 }, { game_key: 'cacaalvo', avg_duration_seconds: 100 }],
    }, 'pt');
    expect(improved).toContain('atenção sustentada melhorou');

    const declined = buildClinicalSummary({
      focusEvolution: [{ game_key: 'cacaalvo', avg_duration_seconds: 80 }, { game_key: 'cacaalvo', avg_duration_seconds: 100 }],
    }, 'pt');
    expect(declined).toContain('duração média de atenção foi de');

    const baseline = buildClinicalSummary({
      focusEvolution: [{ game_key: 'cacaalvo', avg_duration_seconds: 100 }],
    }, 'pt');
    expect(baseline).toContain('Primeira semana de dados de atenção');
  });

  it('picks the impulsivity tier by the 80/60 thresholds', () => {
    expect(buildClinicalSummary({ impulsivityIndex: 90 }, 'pt')).toContain('bom controle');
    expect(buildClinicalSummary({ impulsivityIndex: 70 }, 'pt')).toContain('impulsividade ocasional');
    expect(buildClinicalSummary({ impulsivityIndex: 30 }, 'pt')).toContain('indicando área de atenção');
  });

  it('prefers syllable-difficulty data over the mastered-syllables fallback', () => {
    const withDifficulty = buildClinicalSummary({
      syllableDifficulty: [{ syllable: 'tra', accuracy_pct: 40 }],
      readingProgress: { mastered_syllables: ['ba', 'be'] },
    }, 'pt');
    expect(withDifficulty).toContain('Sílabas com maior dificuldade');
    expect(withDifficulty).not.toContain('já dominadas');

    const masteredOnly = buildClinicalSummary({
      readingProgress: { mastered_syllables: ['ba', 'be'] },
    }, 'pt');
    expect(masteredOnly).toContain('2 sílabas já dominadas');
  });

  it('reports the most frequent phonological swap', () => {
    const text = buildClinicalSummary({
      phonologicalSwaps: [{ expected: 'r', answered: 'l', occurrences: 5 }],
    }, 'pt');
    expect(text).toContain('/r/ → /l/ (5 ocorrências)');
  });

  it('reports persistence as positive when there are help requests and/or retries, with zero abandons', () => {
    const positiveHelp = buildClinicalSummary({ profile: { name: 'Ana' }, frustration: [{ abandons: 0, help_requests: 3, retries: 0 }] }, 'pt');
    expect(positiveHelp).toContain('demonstrou persistência');

    const positiveRetries = buildClinicalSummary({ profile: { name: 'Ana' }, frustration: [{ abandons: 0, help_requests: 0, retries: 2 }] }, 'pt');
    expect(positiveRetries).toContain('demonstrou persistência');

    const negative = buildClinicalSummary({ profile: { name: 'Ana' }, frustration: [{ abandons: 3, help_requests: 0, retries: 0 }] }, 'pt');
    expect(negative).toContain('3 abandonos de atividade');
  });

  it('renders Italian copy when lang is "it"', () => {
    const text = buildClinicalSummary({}, 'it');
    expect(text).toBe("Il bambino ha ancora poche sessioni registrate per generare un'analisi completa.");
  });

  describe('numeracy (Quantos Cocos?)', () => {
    it('says nothing when there is no small-quantity data yet', () => {
      const text = buildClinicalSummary({ cocosSmallQtyAccuracy: null, cocosLargeQtyAccuracy: null }, 'pt');
      expect(text).not.toContain('Cocos');
    });

    it('reports a baseline message when only small-quantity data exists (large-quantity gate not yet met)', () => {
      const text = buildClinicalSummary({ cocosSmallQtyAccuracy: { accuracy_pct: 88 }, cocosLargeQtyAccuracy: null }, 'pt');
      expect(text).toContain('Primeiros dados de senso numérico');
      expect(text).toContain('88%');
    });

    it('flags the "perceptivo bom, conceitual fraco" pattern as its own message, not the generic "good" one', () => {
      const text = buildClinicalSummary({
        profile: { name: 'Ana' },
        cocosSmallQtyAccuracy: { accuracy_pct: 90 }, cocosLargeQtyAccuracy: { accuracy_pct: 55 },
      }, 'pt');
      expect(text).toContain('reconhece quantidades pequenas facilmente');
      expect(text).toContain('90%');
      expect(text).toContain('55%');
    });

    it('reports the positive message when both ranges are solid', () => {
      const text = buildClinicalSummary({
        profile: { name: 'Ana' },
        cocosSmallQtyAccuracy: { accuracy_pct: 85 }, cocosLargeQtyAccuracy: { accuracy_pct: 75 },
      }, 'pt');
      expect(text).toContain('bom senso numérico');
    });

    it('reports the attention message when both ranges are weak', () => {
      const text = buildClinicalSummary({
        cocosSmallQtyAccuracy: { accuracy_pct: 55 }, cocosLargeQtyAccuracy: { accuracy_pct: 40 },
      }, 'pt');
      expect(text).toContain('área de atenção');
      expect(text).toContain('55%');
      expect(text).toContain('40%');
    });

    it('never mentions discalculia - this is not a diagnostic instrument', () => {
      const text = buildClinicalSummary({
        cocosSmallQtyAccuracy: { accuracy_pct: 40 }, cocosLargeQtyAccuracy: { accuracy_pct: 20 },
      }, 'pt');
      expect(text.toLowerCase()).not.toContain('discalculia');
    });
  });
});
