// TESTE SEGURO DO /VIRAL - usa os módulos reais, sem rede e sem WhatsApp
// Executar: node test-viral.js

import assert from 'node:assert/strict';

import {
    CATEGORIAS_VIRAL,
    classificarErroViral,
    mensagemErroViral
} from './lib/viral/erros.js';

import {
    interpretarEntrada
} from './lib/viral/entrada.js';

import {
    selecionarCandidatos
} from './lib/viral/candidatos.js';

import {
    baixarComPolitica,
    processarCandidatos
} from './lib/viral/pipeline.js';

import {
    criarControleDownload,
    criarDeduplicador
} from './lib/viral/controle.js';

console.log('🧪 TESTE SEGURO DO /VIRAL (módulos reais, sem rede)\n');

let checagens = 0;
let falhas = 0;

function verificar(nome, fn) {
    checagens++;

    try {
        fn();
        console.log(`✅ ${nome}`);
    } catch (erro) {
        falhas++;

        console.error(`❌ ${nome}`);
        console.error(`   ${erro?.message}`);
    }
}

async function verificarAsync(nome, fn) {
    checagens++;

    try {
        await fn();
        console.log(`✅ ${nome}`);
    } catch (erro) {
        falhas++;

        console.error(`❌ ${nome}`);
        console.error(`   ${erro?.message}`);
    }
}

verificar('entrada vazia vira instrução de uso', () => {
    assert.equal(interpretarEntrada('   ').tipo, 'vazio');
});

verificar('link malformado não vira busca silenciosa', () => {
    assert.equal(interpretarEntrada('www.youtube.com/watch?v=a').tipo, 'url-invalida');
});

verificar('anti-bot não é reportado como conteúdo privado', () => {
    const cls = classificarErroViral({
        stderr: "Sign in to confirm you're not a bot"
    });

    assert.equal(cls.categoria, CATEGORIAS_VIRAL.VERIFICACAO);
    assert.match(mensagemErroViral({ stderr: 'not a bot' }), /anti-bot/);
});

verificar('conteúdo privado não é retentado', () => {
    const cls = classificarErroViral({
        stderr: 'Private video'
    });

    assert.equal(cls.retentavel, false);
});

verificar('busca escolhe a melhor correspondência, não a primeira', () => {
    const { candidatos } = selecionarCandidatos(
        {
            entries: [
                {
                    id: 'RUIM',
                    title: 'Song X (10 hours loop)',
                    duration: 36000,
                    webpage_url: 'https://x/RUIM'
                },
                {
                    id: 'BOA',
                    title: 'Artista - Song X (Official Video)',
                    duration: 210,
                    webpage_url: 'https://x/BOA'
                }
            ]
        },
        'Artista Song X'
    );

    assert.equal(candidatos[0].url, 'https://x/BOA');
});

await verificarAsync('candidato restrito cai para a alternativa', async () => {
    const resultado = await processarCandidatos({
        candidatos: [
            { url: 'https://x/1' },
            { url: 'https://x/2' }
        ],
        agora: () => 100000,
        tentarCandidato: async (candidato, indice) => {
            if (indice === 0) {
                const erro = new Error('Private video');
                erro.classificacaoViral = classificarErroViral(erro);

                throw erro;
            }

            return candidato.url;
        }
    });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.candidato.url, 'https://x/2');
});

await verificarAsync('retry com espera em falha transitória', async () => {
    const esperas = [];
    let chamadas = 0;

    const resultado = await baixarComPolitica({
        tentarBaixar: async () => {
            chamadas++;

            if (chamadas === 1) {
                throw new Error('getaddrinfo ENOTFOUND');
            }

            return 'ok';
        },
        classificar: erro => classificarErroViral(erro),
        esperar: async ms => esperas.push(ms),
        agora: () => 100000
    });

    assert.equal(resultado, 'ok');
    assert.equal(chamadas, 2);
    assert.deepEqual(esperas, [2000]);
});

verificar('lock impede downloads concorrentes', () => {
    const controle = criarControleDownload();

    assert.equal(controle.tentarIniciar('a'), true);
    assert.equal(controle.tentarIniciar('b'), false);

    controle.finalizar();

    assert.equal(controle.tentarIniciar('b'), true);
});

verificar('deduplicador ignora mensagem repetida', () => {
    const dedup = criarDeduplicador();

    assert.equal(dedup.jaVisto('MSG'), false);
    dedup.marcar('MSG');
    assert.equal(dedup.jaVisto('MSG'), true);
});

console.log('');

if (falhas) {
    console.error(`❌ ${falhas} de ${checagens} checagens falharam.`);
    process.exitCode = 1;
} else {
    console.log(`🎉 TODAS AS ${checagens} CHECAGENS PASSARAM`);
    console.log('ℹ️ Este teste NÃO usa rede e NÃO conecta ao WhatsApp.');
}
