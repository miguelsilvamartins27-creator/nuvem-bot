import fs from 'node:fs/promises';
import path from 'node:path';

import { fileTypeFromFile } from 'file-type';

export const MIN_BYTES_AUDIO = 1024;
export const MAX_BYTES_AUDIO = 30 * 1024 * 1024;

const MIMES_AUDIO = new Set([
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/ogg',
    'audio/opus',
    'audio/webm',
    'audio/x-flac',
    'audio/flac',
    'audio/vnd.wave',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/vnd.dlna.adts'
]);

function pareceMp3(cabecalho) {
    if (cabecalho.length >= 3 &&
        cabecalho[0] === 0x49 &&
        cabecalho[1] === 0x44 &&
        cabecalho[2] === 0x33
    ) {
        return true;
    }

    return cabecalho.length >= 2 &&
        cabecalho[0] === 0xff &&
        (cabecalho[1] & 0xe0) === 0xe0;
}

async function lerCabecalho(caminho, bytes = 4) {
    const identificador = await fs.open(caminho, 'r');

    try {
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await identificador.read(buffer, 0, bytes, 0);

        return buffer.subarray(0, bytesRead);
    } finally {
        await identificador.close();
    }
}

export async function validarArquivoAudio(
    caminho,
    { maxBytes = MAX_BYTES_AUDIO, minBytes = MIN_BYTES_AUDIO } = {}
) {
    let info;

    try {
        info = await fs.stat(caminho);
    } catch {
        return {
            ok: false,
            motivo: 'inexistente',
            mime: null,
            ext: null,
            tamanhoBytes: 0
        };
    }

    if (!info.isFile()) {
        return {
            ok: false,
            motivo: 'nao-arquivo',
            mime: null,
            ext: null,
            tamanhoBytes: 0
        };
    }

    if (info.size < minBytes) {
        return {
            ok: false,
            motivo: 'vazio',
            mime: null,
            ext: null,
            tamanhoBytes: info.size
        };
    }

    if (info.size > maxBytes) {
        return {
            ok: false,
            motivo: 'grande',
            mime: null,
            ext: null,
            tamanhoBytes: info.size
        };
    }

    let tipo = null;

    try {
        tipo = await fileTypeFromFile(caminho);
    } catch {
        tipo = null;
    }

    if (tipo && MIMES_AUDIO.has(tipo.mime)) {
        return {
            ok: true,
            motivo: null,
            mime: tipo.mime,
            ext: tipo.ext,
            tamanhoBytes: info.size
        };
    }

    let cabecalho = Buffer.alloc(0);

    try {
        cabecalho = await lerCabecalho(caminho);
    } catch {
        cabecalho = Buffer.alloc(0);
    }

    if (pareceMp3(cabecalho)) {
        return {
            ok: true,
            motivo: null,
            mime: 'audio/mpeg',
            ext: 'mp3',
            tamanhoBytes: info.size
        };
    }

    return {
        ok: false,
        motivo: 'invalido',
        mime: tipo?.mime || null,
        ext: tipo?.ext || null,
        tamanhoBytes: info.size
    };
}

export function nomeSeguroAudio(titulo) {
    if (!titulo) {
        return null;
    }

    return (
        String(titulo)
            .replace(/[^\p{L}\p{N}\s._-]/gu, '')
            .trim()
            .slice(0, 80) || 'audio'
    );
}

export async function limparArquivosPasta(pasta) {
    if (!pasta) {
        return;
    }

    try {
        const arquivos = await fs.readdir(pasta);

        for (const arquivo of arquivos) {
            await fs.rm(
                path.join(pasta, arquivo),
                {
                    recursive: true,
                    force: true
                }
            );
        }
    } catch {}
}
