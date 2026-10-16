import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processarCandidatos } from '../lib/viral/pipeline.js';

describe('fallback entre fontes', () => {
    it('tenta fonte independente mesmo quando a primeira fonte retorna bloqueio não retentável', async () => {
        const candidatos = [
            { url: 'https://youtube.example/1', fonte: 'YouTube' },
            { url: 'https://youtube.example/2', fonte: 'YouTube' },
            { url: 'https://archive.org/download/open/song.mp3', fonte: 'Internet Archive' }
        ];
        const chamados = [];

        const resultado = await processarCandidatos({
            candidatos,
            maxCandidatos: 3,
            agora: () => 100000,
            tentarCandidato: async candidato => {
                chamados.push(candidato.fonte);
                if (candidato.fonte === 'YouTube') {
                    const erro = new Error('HTTP 429');
                    erro.classificacaoViral = {
                        categoria: 'limite',
                        aceitaProximoCandidato: false,
                        retentavel: false,
                        rotulo: 'bloqueio temporário'
                    };
                    throw erro;
                }
                return 'audio-ok';
            }
        });

        assert.equal(resultado.ok, true);
        assert.equal(resultado.candidato.fonte, 'Internet Archive');
        assert.deepEqual(chamados, ['YouTube', 'Internet Archive']);
    });
});
