import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pesquisarInternetArchive } from '../lib/viral/fontes.js';

function respostaJson(valor, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => valor
    };
}

describe('fallback Internet Archive', () => {
    it('retorna apenas arquivos de áudio com licença aberta explícita', async () => {
        const fetchImpl = async url => {
            const parsed = new URL(url);
            if (parsed.pathname.endsWith('/advancedsearch.php')) {
                return respostaJson({
                    response: {
                        docs: [
                            { identifier: 'open-song', title: 'Open Song' },
                            { identifier: 'unknown-rights', title: 'Unknown Rights' }
                        ]
                    }
                });
            }
            if (parsed.pathname === '/metadata/open-song') {
                return respostaJson({
                    metadata: {
                        title: 'Open Song',
                        licenseurl: 'https://creativecommons.org/licenses/by/4.0/'
                    },
                    files: [
                        { name: 'cover.jpg', format: 'JPEG' },
                        { name: 'song.mp3', format: 'VBR MP3', private: false }
                    ]
                });
            }
            if (parsed.pathname === '/metadata/unknown-rights') {
                return respostaJson({
                    metadata: { title: 'Unknown Rights' },
                    files: [{ name: 'song.mp3', format: 'MP3' }]
                });
            }
            throw new Error('URL inesperada: ' + url);
        };

        const resultado = await pesquisarInternetArchive('Open Song', { fetchImpl });
        assert.equal(resultado.length, 1);
        assert.equal(resultado[0].fonte, 'Internet Archive');
        assert.equal(resultado[0].titulo, 'Open Song');
        assert.match(resultado[0].url, /^https:\/\/archive\.org\/download\/open-song\//);
    });


    it('rejeita texto que apenas menciona CC0 e licenças sem permissão de adaptação', async () => {
        const fetchImpl = async url => {
            const parsed = new URL(url);
            if (parsed.pathname.endsWith('/advancedsearch.php')) {
                return respostaJson({ response: { docs: [
                    { identifier: 'fake-cc0', title: 'Fake CC0' },
                    { identifier: 'no-derivatives', title: 'No Derivatives' }
                ] } });
            }
            if (parsed.pathname === '/metadata/fake-cc0') {
                return respostaJson({
                    metadata: { licenseurl: 'https://example.org/CC0-is-not-a-license' },
                    files: [{ name: 'song.mp3', format: 'MP3' }]
                });
            }
            if (parsed.pathname === '/metadata/no-derivatives') {
                return respostaJson({
                    metadata: { licenseurl: 'https://creativecommons.org/licenses/by-nd/4.0/' },
                    files: [{ name: 'song.mp3', format: 'MP3' }]
                });
            }
            throw new Error('URL inesperada: ' + url);
        };

        const resultado = await pesquisarInternetArchive('teste', { fetchImpl });
        assert.deepEqual(resultado, []);
    });

    it('limita quantidade de candidatos a um valor seguro', async () => {
        let chamadas = 0;
        const resultado = await pesquisarInternetArchive('teste', {
            limite: 0,
            fetchImpl: async () => { chamadas++; throw new Error('não deveria chamar'); }
        });
        assert.deepEqual(resultado, []);
        assert.equal(chamadas, 0);
    });

    it('falha de rede resulta em lista vazia, sem derrubar o comando', async () => {
        const resultado = await pesquisarInternetArchive('qualquer música', {
            fetchImpl: async () => { throw new Error('offline'); }
        });
        assert.deepEqual(resultado, []);
    });

    it('termo vazio não faz requisição', async () => {
        let chamadas = 0;
        const resultado = await pesquisarInternetArchive('   ', {
            fetchImpl: async () => { chamadas++; throw new Error('não deveria chamar'); }
        });
        assert.deepEqual(resultado, []);
        assert.equal(chamadas, 0);
    });
});
