// Referências consultadas em 2026-10-16 (valores mudam sem aviso; use como aviso, não como verdade):
// - Groq: console.groq.com/docs/rate-limits (tabelas lidas em 11/10/2026 via freellm.today)
// - Gemini: ai.google.dev/gemini-api/docs/rate-limits (limites por projeto; sem tabela estável publicada)
// - OpenRouter: openrouter.ai/docs/api_reference/limits (20 RPM / 50 RPD; 1.000 RPD após US$10 vitalícios)
// O roteador prioriza os erros reais das APIs (429 etc.); estes números servem apenas
// para aviso antecipado e para o limite duro opcional (IA_LIMITES_DUROS=true).

export const REFERENCIA_LIMITES_IA =
    '2026-10-16';

export const LIMITES_DIARIOS_PADRAO = {
    groq: 1000,
    gemini: 250,
    openrouter: 50
};

export function obterLimiteDiario(
    provedor,
    limites = LIMITES_DIARIOS_PADRAO
) {
    const valor =
        Number(
            limites?.[provedor]
        );

    return Number.isFinite(valor) &&
        valor > 0
        ? valor
        : null;
}
