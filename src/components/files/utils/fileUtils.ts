// File utility functions — pure, no React, no side effects
import type { TextFileEncoding } from '../../../shared/types';

export function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function joinPath(base: string, name: string): string {
    if (base === '/') return `/${name}`;
    return `${base}/${name}`;
}

export function parentPath(path: string): string {
    if (path === '/') return '/';
    const parts = path.split('/');
    parts.pop();
    return parts.length <= 1 ? '/' : parts.join('/');
}

const IMAGE_EXTS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
]);

const TEXT_EXTS = new Set([
    'txt', 'md', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
    'sh', 'bash', 'zsh', 'fish', 'ps1',
    'js', 'ts', 'jsx', 'tsx', 'vue', 'svelte',
    'py', 'rb', 'php', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs',
    'html', 'htm', 'css', 'scss', 'sass', 'less',
    'xml', 'svg', 'env', 'log', 'csv', 'sql',
    'dockerfile', 'makefile', 'gitignore', 'htaccess',
]);

const BINARY_EXTS = new Set([
    'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
    'exe', 'bin', 'so', 'dll', 'dylib',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'mp3', 'mp4', 'mkv', 'avi', 'mov', 'flac', 'ogg',
    'ttf', 'otf', 'woff', 'woff2',
    'ico', 'icns',
]);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    avif: 'image/avif',
};

export const TEXT_ENCODING_OPTIONS: Array<{ value: TextFileEncoding; label: string }> = [
    { value: 'utf-8', label: 'UTF-8' },
    { value: 'gb18030', label: 'GB18030 / GBK' },
    { value: 'big5', label: 'Big5' },
    { value: 'shift_jis', label: 'Shift_JIS' },
    { value: 'windows-1252', label: 'Windows-1252' },
    { value: 'utf-16le', label: 'UTF-16 LE' },
    { value: 'utf-16be', label: 'UTF-16 BE' },
];

export function base64ToBytes(base64: string): Uint8Array {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

export function detectImageMime(name: string, bytes: Uint8Array): string | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)).startsWith('GIF8')) return 'image/gif';
    if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
    if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'image/x-icon';
    if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x66) return 'image/avif';

    const extensionMime = IMAGE_MIME_BY_EXTENSION[getExtension(name)];
    if (extensionMime === 'image/svg+xml') {
        const prefix = new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(bytes.length, 1024))).trimStart();
        return /^(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(prefix) ? extensionMime : null;
    }
    return extensionMime ?? null;
}

export function isProbablyBinary(bytes: Uint8Array): boolean {
    if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return true;
    const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
    let controls = 0;
    for (const byte of sample) {
        if (byte === 0) return true;
        if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) controls += 1;
    }
    return sample.length > 0 && controls / sample.length > 0.08;
}

export function detectTextEncoding(bytes: Uint8Array): TextFileEncoding {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return 'utf-8';
    } catch {
        return 'gb18030';
    }
}

export function decodeText(bytes: Uint8Array, encoding: TextFileEncoding): string {
    return new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, '');
}

export function getExtension(name: string): string {
    const parts = name.toLowerCase().split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function isImageFile(name: string): boolean {
    return IMAGE_EXTS.has(getExtension(name));
}

export function isTextFile(name: string): boolean {
    const ext = getExtension(name);
    if (!ext) return true; // extensionless files often are text (Makefile etc)
    return TEXT_EXTS.has(ext);
}

export function isBinaryFile(name: string): boolean {
    return BINARY_EXTS.has(getExtension(name));
}

export type FileKind = 'folder' | 'image' | 'text' | 'binary' | 'unknown';

export function getFileKind(name: string, type: string): FileKind {
    if (type === 'd') return 'folder';
    if (isImageFile(name)) return 'image';
    if (isTextFile(name)) return 'text';
    if (isBinaryFile(name)) return 'binary';
    return 'unknown';
}
