import semver from 'semver';

export interface UnixSocketListenOptions {
    isTcp: false;
    listen: string;
    chmod?: string;
}

export interface TcpListenOptions {
    isTcp: true;
    listen: number;
    host: string;
}

export type WebListenOptions = UnixSocketListenOptions | TcpListenOptions;

// this is the node version I used during development, so lets just restrict runtime usage to that version to avoid unexpected problems lol
const NODE_VERSION_TO_RUN = '^22.0.0';
if (!semver.satisfies(process.version, NODE_VERSION_TO_RUN)) {
    throw new Error(`The current node version ${process.version} does not satisfy the required version ${NODE_VERSION_TO_RUN}.`);
}

function getEnvNumber(key: string, defaultValue: number): number;
function getEnvNumber(key: string): number | undefined;
function getEnvNumber(key: string, defaultValue?: number): number | undefined {
    var rawValue = process.env[key];
    if (!rawValue) return defaultValue;
    var parsedValue = parseInt(rawValue, 10);
    return parsedValue ? parsedValue : defaultValue;
}

function getEnvNumberOrStringWithData<T>(key: string, defaultValue: number | string, onNumber: (num: number) => T, onString: (str: string) => T): T {
    var rawValue = process.env[key];
    if (!rawValue) {
        if (typeof defaultValue === 'number') {
            return onNumber(defaultValue);
        } else {
            return onString(defaultValue);
        }
    }
    var parsedValue = parseInt(rawValue, 10);
    if (parsedValue) {
        return onNumber(parsedValue);
    } else {
        return onString(rawValue);
    }
}

// these 2 constants are properties from the svg's on osu! servers
// we're assuming those properties will never change
// if they do, the output will be kind of fucked up
const OSU_FLAG_DENSITY = getEnvNumber('FLAG_DENSITY', 72);
const OSU_FLAG_WIDTH = getEnvNumber('FLAG_WIDTH', 36);

const MAX_SIZE = getEnvNumber('MAX_SIZE', 1000);
export const DEFAULT_SIZE = getEnvNumber('DEFAULT_SIZE', 128);
export const CACHE_SECONDS = getEnvNumber('CACHE_SECONDS', 604_800); // one week

export const HTTP_TIMEOUT = getEnvNumber('HTTP_TIMEOUT', 1000);

export const DENSITY_FACTOR = OSU_FLAG_DENSITY / OSU_FLAG_WIDTH;
// max density is 100,000, so our absolute max allowed size is 100,000/DENSITY_FACTOR
export const ACTUAL_MAX_SIZE = Math.min(Math.floor(100_000 / DENSITY_FACTOR), MAX_SIZE);

if (DEFAULT_SIZE > ACTUAL_MAX_SIZE) {
    throw new Error(`default size (${DEFAULT_SIZE}) is greater than max allowed size (${ACTUAL_MAX_SIZE})`);
}

const LISTEN_HOST = process.env.LISTEN_HOST ?? 'localhost';
const LISTEN_CHMOD = process.env.LISTEN_CHMOD;
export const WEB_LISTEN_OPTIONS = getEnvNumberOrStringWithData<WebListenOptions>('LISTEN', 3000,
    num => ({ isTcp: true, listen: num, host: LISTEN_HOST }),
    str => ({ isTcp: false, listen: str, chmod: LISTEN_CHMOD })
);

export const REDIS_SOCKET = process.env.REDIS_SOCKET;
export const REDIS_PORT = getEnvNumber('REDIS_PORT');
export const REDIS_HOST = process.env.REDIS_HOST;
export const REDIS_PREFIX = process.env.REDIS_PREFIX || 'osu-flags-proxy';
export const REDIS_DATABASE = getEnvNumber('REDIS_DATABASE');
