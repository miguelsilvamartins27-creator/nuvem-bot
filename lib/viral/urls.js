import dns from 'node:dns/promises';

import ipaddr from 'ipaddr.js';

import { textoSeguro, isUrl, urlPublicaSegura } from '../utilidades.js';

// Faixas nunca liberadas para download: privadas, locais, reservadas,
// multicast ou de trânsito IPv6 que pode encapsular endereços internos.
const RANGES_BLOQUEADOS = new Set([
    'unspecified',
    'broadcast',
    'multicast',
    'linkLocal',
    'loopback',
    'carrierGradeNat',
    'private',
    'reserved',
    'as112',
    'amt',
    'uniqueLocal',
    'ipv4Mapped',
    'rfc6145',
    'rfc6052',
    '6to4',
    'teredo'
]);

function semColchetes(host) {
    const valor = String(host || '');

    return valor.startsWith('[') && valor.endsWith(']')
        ? valor.slice(1, -1)
        : valor;
}

export function enderecoPrivado(endereco) {
    const valor = semColchetes(endereco).toLowerCase().trim();

    if (!valor) {
        return true;
    }

    let alvo;

    try {
        alvo = ipaddr.parse(valor);
    } catch {
        return true;
    }

    if (alvo.kind() === 'ipv6' && alvo.isIPv4MappedAddress()) {
        alvo = alvo.toIPv4Address();
    }

    try {
        return RANGES_BLOQUEADOS.has(alvo.range());
    } catch {
        return true;
    }
}

// Limitação conhecida e documentada (DNS rebinding / redirecionamentos):
// o yt-dlp re-resolve o host e segue redirecionamentos por conta própria no
// momento do download, então não é possível garantir daqui qual endereço
// será efetivamente acessado (isso exigiria controlar o cliente HTTP).
// Mitigações adotadas, compatíveis com a arquitetura atual:
// - nunca liberar IP literal privado/reservado (fail-closed);
// - verificação DNS com todas as respostas públicas obrigatórias;
// - revalidação do link imediatamente antes do download (ver comandoViral
//   no index.js), reduzindo a janela entre validação e uso.
export async function validarUrlViral(texto, { resolver = dns.lookup } = {}) {
    const valor = textoSeguro(texto);

    if (!isUrl(valor)) {
        return {
            ok: false,
            motivo: 'formato',
            url: null
        };
    }

    if (!urlPublicaSegura(valor)) {
        return {
            ok: false,
            motivo: 'privado',
            url: null
        };
    }

    const alvo = new URL(valor);

    if (alvo.username || alvo.password) {
        return {
            ok: false,
            motivo: 'credenciais',
            url: null
        };
    }

    const hostLimpo = semColchetes(alvo.hostname).toLowerCase();

    if (ipaddr.isValid(hostLimpo)) {
        if (enderecoPrivado(hostLimpo)) {
            return {
                ok: false,
                motivo: 'privado',
                url: null
            };
        }

        return {
            ok: true,
            motivo: null,
            url: valor
        };
    }

    try {
        const enderecos = await resolver(hostLimpo, {
            all: true,
            verbatim: false
        });

        const lista = Array.isArray(enderecos) ? enderecos : [enderecos];

        for (const item of lista) {
            const endereco = typeof item === 'string' ? item : item?.address;

            if (enderecoPrivado(endereco)) {
                return {
                    ok: false,
                    motivo: 'privado',
                    url: null
                };
            }
        }
    } catch {
        return {
            ok: false,
            motivo: 'dns',
            url: null
        };
    }

    return {
        ok: true,
        motivo: null,
        url: valor
    };
}
