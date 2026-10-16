import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    MODELO_VISAO_PADRAO,
    LIMITE_IMAGEM_VISAO_MB,
    LIMITE_REDUCAO_IMAGEM_MB,
    decidirImagem,
    ehComandoFoto,
    detectarIntencaoRegistro,
    limparLegendaFoto,
    deveProcessarFoto,
    instrucaoSistemaVisao,
    montarMensagensVisao,
    extrairRegistroDaAnalise,
    mensagemErroVisao
} from '../lib/visao.js';

describe('constantes de visão', () => {
    it('modelo padrão é o configurado', () => {
        assert.equal(MODELO_VISAO_PADRAO, 'qwen/qwen3.8-27b');
    });

    it('limites são coerentes', () => {
        assert.equal(LIMITE_IMAGEM_VISAO_MB, 20);
        assert.equal(LIMITE_REDUCAO_IMAGEM_MB, 4);
        assert.ok(LIMITE_REDUCAO_IMAGEM_MB < LIMITE_IMAGEM_VISAO_MB);
    });
});

describe('decidirImagem', () => {
    it('aceita imagem pequena sem reduzir', () => {
        const decisao = decidirImagem(1024 * 1024);

        assert.equal(decisao.ok, true);
        assert.equal(decisao.reduzir, false);
    });

    it('marca para reduzir acima do limite de redução', () => {
        const decisao = decidirImagem(5 * 1024 * 1024);

        assert.equal(decisao.ok, true);
        assert.equal(decisao.reduzir, true);
    });

    it('rejeita imagem acima do limite máximo', () => {
        const decisao = decidirImagem(21 * 1024 * 1024);

        assert.equal(decisao.ok, false);
        assert.equal(decisao.reduzir, false);
    });

    it('trata tamanho desconhecido ou inválido como aceitável', () => {
        assert.equal(decidirImagem(0).ok, true);
        assert.equal(decidirImagem(undefined).ok, true);
        assert.equal(decidirImagem(NaN).ok, true);
    });

    it('aceita exatamente o limite máximo', () => {
        const decisao = decidirImagem(20 * 1024 * 1024);

        assert.equal(decisao.ok, true);
        assert.equal(decisao.reduzir, true);
    });
});

describe('ehComandoFoto', () => {
    it('reconhece /registrar e /salvar', () => {
        assert.equal(ehComandoFoto('/registrar'), true);
        assert.equal(ehComandoFoto('/registrar almoço'), true);
        assert.equal(ehComandoFoto('/SALVAR isso'), true);
    });

    it('não reconhece outros comandos', () => {
        assert.equal(ehComandoFoto('/treino corrida'), false);
        assert.equal(ehComandoFoto('/viral musica'), false);
        assert.equal(ehComandoFoto('registrar sem barra'), false);
        assert.equal(ehComandoFoto(''), false);
    });
});

describe('detectarIntencaoRegistro', () => {
    it('detecta pedidos de registro', () => {
        assert.equal(detectarIntencaoRegistro('registra essa refeição'), true);
        assert.equal(detectarIntencaoRegistro('/registrar almoço'), true);
        assert.equal(detectarIntencaoRegistro('salva isso'), true);
        assert.equal(detectarIntencaoRegistro('anota aí'), true);
        assert.equal(detectarIntencaoRegistro('guarda essa refeição'), true);
        assert.equal(detectarIntencaoRegistro('gravA no meu diário'), true);
    });

    it('não detecta em conversa normal', () => {
        assert.equal(detectarIntencaoRegistro('o que tem nessa foto?'), false);
        assert.equal(detectarIntencaoRegistro('oi tudo bem'), false);
        assert.equal(detectarIntencaoRegistro(''), false);
        assert.equal(detectarIntencaoRegistro(null), false);
    });

    it('não detecta formas não listadas', () => {
        assert.equal(detectarIntencaoRegistro('guardei a foto ontem'), false);
        assert.equal(detectarIntencaoRegistro('salvamento de dados'), false);
    });

    it('respeita negação', () => {
        assert.equal(detectarIntencaoRegistro('não quero registrar isso'), false);
        assert.equal(detectarIntencaoRegistro('nao precisa salvar'), false);
    });
});

describe('limparLegendaFoto', () => {
    it('remove o comando de registro do início', () => {
        assert.equal(limparLegendaFoto('/registrar almoço com arroz'), 'almoço com arroz');
        assert.equal(limparLegendaFoto('/salvar 2 fatias de pizza'), '2 fatias de pizza');
    });

    it('remove comando sozinho', () => {
        assert.equal(limparLegendaFoto('/registrar'), '');
    });

    it('mantém legenda normal', () => {
        assert.equal(limparLegendaFoto('o que tem aqui?'), 'o que tem aqui?');
    });
});

describe('deveProcessarFoto', () => {
    it('processa foto direta sem legenda', () => {
        assert.equal(
            deveProcessarFoto({ temImagemDireta: true, texto: '' }),
            true
        );
    });

    it('processa foto direta com legenda normal ou pergunta', () => {
        assert.equal(
            deveProcessarFoto({ temImagemDireta: true, texto: 'o que tem nessa comida?' }),
            true
        );
        assert.equal(
            deveProcessarFoto({ temImagemDireta: true, texto: 'registra essa refeição' }),
            true
        );
    });

    it('processa foto direta com comando de registro', () => {
        assert.equal(
            deveProcessarFoto({ temImagemDireta: true, texto: '/registrar almoço' }),
            true
        );
    });

    it('não desvia comandos existentes com foto anexada', () => {
        assert.equal(
            deveProcessarFoto({ temImagemDireta: true, texto: '/viral musica' }),
            false
        );
        assert.equal(
            deveProcessarFoto({ temImagemDireta: true, texto: '/treino corrida' }),
            false
        );
        assert.equal(
            deveProcessarFoto({ temImagemDireta: true, texto: '/s' }),
            false
        );
    });

    it('processa imagem citada apenas com pedido de registro', () => {
        assert.equal(
            deveProcessarFoto({ temImagemCitada: true, texto: 'registra essa refeição' }),
            true
        );
        assert.equal(
            deveProcessarFoto({ temImagemCitada: true, texto: 'kkk' }),
            false
        );
    });

    it('não processa mensagens de texto sem imagem', () => {
        assert.equal(
            deveProcessarFoto({ texto: 'qual a capital da frança?' }),
            false
        );
        assert.equal(
            deveProcessarFoto({ texto: '/viral musica' }),
            false
        );
        assert.equal(
            deveProcessarFoto({ texto: 'oi' }),
            false
        );
        assert.equal(deveProcessarFoto({}), false);
        assert.equal(deveProcessarFoto(), false);
    });
});

describe('instrucaoSistemaVisao', () => {
    it('usa o nome do bot', () => {
        const instrucao = instrucaoSistemaVisao({ nomeBot: 'Bolsonaro' });

        assert.match(instrucao, /Bolsonaro/);
    });

    it('contém as regras pedidas', () => {
        const instrucao = instrucaoSistemaVisao();

        assert.match(instrucao, /alimentos visíveis/i);
        assert.match(instrucao, /NÃO invente/i);
        assert.match(instrucao, /estimativa é aproximada/i);
        assert.match(instrucao, /pergunte as quantidades/i);
        assert.match(instrucao, /REGISTRO:/);
    });
});

describe('montarMensagensVisao', () => {
    it('monta mensagens com data URL e pergunta', () => {
        const mensagens = montarMensagensVisao({
            base64: 'QUJD',
            mimetype: 'image/jpeg',
            legenda: 'o que tem aqui?'
        });

        assert.equal(mensagens.length, 2);
        assert.equal(mensagens[0].role, 'system');
        assert.equal(mensagens[1].role, 'user');
        assert.equal(mensagens[1].content[0].type, 'text');
        assert.equal(mensagens[1].content[0].text, 'o que tem aqui?');
        assert.equal(mensagens[1].content[1].type, 'image_url');
        assert.equal(
            mensagens[1].content[1].image_url.url,
            'data:image/jpeg;base64,QUJD'
        );
    });

    it('usa pergunta padrão quando não há legenda', () => {
        const mensagens = montarMensagensVisao({ base64: 'QUJD' });

        assert.match(mensagens[1].content[0].text, /Identifique os alimentos/i);
    });

    it('usa instrução personalizada quando fornecida', () => {
        const mensagens = montarMensagensVisao({
            base64: 'QUJD',
            instrucao: 'instrução de teste'
        });

        assert.equal(mensagens[0].content, 'instrução de teste');
    });

    it('normaliza mimetype para minúsculas', () => {
        const mensagens = montarMensagensVisao({
            base64: 'QUJD',
            mimetype: 'IMAGE/PNG'
        });

        assert.match(mensagens[1].content[1].image_url.url, /^data:image\/png;base64,/);
    });

    it('rejeita imagem ausente', () => {
        assert.throws(
            () => montarMensagensVisao({}),
            /Imagem ausente/
        );
    });

    it('rejeita formato que não é imagem', () => {
        assert.throws(
            () => montarMensagensVisao({ base64: 'QUJD', mimetype: 'application/pdf' }),
            /Formato de arquivo não suportado/
        );
    });
});

describe('extrairRegistroDaAnalise', () => {
    it('extrai e remove a linha REGISTRO', () => {
        const analise =
            '🥗 Identifiquei arroz, feijão e frango.\n\n💡 Estimativa aproximada.\n\nREGISTRO: arroz, feijão e frango grelhado';

        const resultado = extrairRegistroDaAnalise(analise);

        assert.equal(resultado.registro, 'arroz, feijão e frango grelhado');
        assert.ok(!resultado.texto.includes('REGISTRO'));
        assert.match(resultado.texto, /Identifiquei/);
    });

    it('limpa markdown do registro', () => {
        const resultado = extrairRegistroDaAnalise(
            'texto\nREGISTRO: *arroz* e `feijão`'
        );

        assert.equal(resultado.registro, 'arroz e feijão');
    });

    it('retorna registro nulo quando não há linha', () => {
        const resultado = extrairRegistroDaAnalise('só uma análise normal');

        assert.equal(resultado.registro, null);
        assert.equal(resultado.texto, 'só uma análise normal');
    });

    it('funciona com variações de caixa e espaços', () => {
        const resultado = extrairRegistroDaAnalise('análise\n registro :  pizza');

        assert.equal(resultado.registro, 'pizza');
    });

    it('lida com entrada vazia', () => {
        const resultado = extrairRegistroDaAnalise('');

        assert.equal(resultado.texto, '');
        assert.equal(resultado.registro, null);
    });
});

describe('mensagemErroVisao', () => {
    it('modelo indisponível sugere /refeicao', () => {
        const mensagem = mensagemErroVisao({ status: 404 });

        assert.match(mensagem, /indisponível/);
        assert.match(mensagem, /qwen\/qwen3\.8-27b/);
        assert.match(mensagem, /\/refeicao/);
    });

    it('modelo não encontrado por mensagem', () => {
        const mensagem = mensagemErroVisao({
            status: 400,
            message: 'The model `qwen/qwen3.8-27b` does not exist'
        });

        assert.match(mensagem, /indisponível/);
    });

    it('chave recusada', () => {
        const mensagem = mensagemErroVisao({ status: 401 });

        assert.match(mensagem, /chave da Groq/i);
    });

    it('limite de requisições', () => {
        const mensagem = mensagemErroVisao({ status: 429 });

        assert.match(mensagem, /limite/i);
    });

    it('imagem inválida', () => {
        const mensagem = mensagemErroVisao({
            status: 400,
            message: 'image is too large or invalid'
        });

        assert.match(mensagem, /imagem/i);
    });

    it('formato não suportado', () => {
        const mensagem = mensagemErroVisao(
            new Error('Formato de arquivo não suportado para análise.')
        );

        assert.match(mensagem, /imagem/i);
    });

    it('erro genérico tem fallback útil', () => {
        const mensagem = mensagemErroVisao(new Error('erro desconhecido'));

        assert.match(mensagem, /Não consegui analisar/);
        assert.match(mensagem, /\/refeicao/);
    });

    it('não quebra com entrada nula', () => {
        const mensagem = mensagemErroVisao(null);

        assert.equal(typeof mensagem, 'string');
        assert.ok(mensagem.length > 0);
    });
});

describe('regressão: mensagens de texto continuam no fluxo normal', () => {
    it('texto puro nunca é desviado para visão', () => {
        const textos = [
            'oi',
            'qual a capital da frança?',
            'me ajuda com um treino',
            'como fazer arroz?',
            'obrigado!'
        ];

        for (const texto of textos) {
            assert.equal(
                deveProcessarFoto({ texto }),
                false,
                `texto desviado: ${texto}`
            );
        }
    });

    it('comandos de texto não são afetados pelas regras de foto', () => {
        const comandos = [
            '/viral musica',
            '/audio https://youtube.com/x',
            '/treino corrida 30min',
            '/refeicao arroz e feijão',
            '/refeicoes',
            '/treinos',
            '/resumo',
            '/excluir treino 1',
            '/config',
            '/perfil',
            '/cmd'
        ];

        for (const comando of comandos) {
            assert.equal(
                deveProcessarFoto({ texto: comando }),
                false,
                `comando desviado: ${comando}`
            );

            assert.equal(
                detectarIntencaoRegistro(comando) && deveProcessarFoto({ texto: comando }),
                false,
                `comando com intenção indevida: ${comando}`
            );
        }
    });

    it('descrições de refeição por texto continuam válidas no sistema de registros', async () => {
        const { sanitizarDescricao, criarRegistro } = await import('../lib/registros.js');

        const descricao = sanitizarDescricao('arroz, feijão e bife');

        assert.equal(descricao, 'arroz, feijão e bife');

        const registro = criarRegistro(descricao, 'refeicao', 1000);

        assert.equal(registro.tipo, 'refeicao');
        assert.equal(registro.descricao, 'arroz, feijão e bife');
    });
});
