import type { RedisClientType, RedisModules, RedisFunctions } from '@redis/client';
import type { Readable } from 'stream';

import sharp from 'sharp';
import https from 'https';
import zlib from 'zlib';
import { commandOptions, defineScript, createClient } from '@redis/client';
const RETBUF = commandOptions({ returnBuffers: true });
const EMPTY_BUF = Buffer.allocUnsafe(0);

const REDIS_SCRIPTS = {
    hSetOnlyIfKeyExists: defineScript({
        NUMBER_OF_KEYS: 1,
        SCRIPT: 'if redis.call(\'EXISTS\', KEYS[1])==1 then return redis.call(\'HSET\', KEYS[1], ARGV[1], ARGV[2]) end',
        transformArguments(key: string, field: string, value: Buffer) { return [key, field, value]; },
        transformReply(reply: number) { return reply; }
    }),
    hSetEx: defineScript({
        NUMBER_OF_KEYS: 1,
        SCRIPT: 'local val = redis.call(\'HSET\', KEYS[1], ARGV[2], ARGV[3]); redis.call(\'EXPIRE\', KEYS[1], ARGV[1]); return val;',
        transformArguments(key: string, seconds: number, field: string, value: Buffer) { return [key, seconds.toString(), field, value]; },
        transformReply(reply: number) { return reply; }
    })
};

declare type CustomRedisType = RedisClientType<RedisModules, RedisFunctions, typeof REDIS_SCRIPTS>;

export interface RedisOptions {
    socketPath?: string;
    port?: number;
    host?: string;
    keyPrefix: string;
    databae?: number;
}

function getOsuFlagSvgUrl(xx: string): string {
    xx = xx.toUpperCase();
    const svgIdentifier = [...Array(xx.length).keys()].map(i => (xx.charCodeAt(i) + 127397).toString(16)).join('-');
    return `https://osu.ppy.sh/assets/images/flags/${svgIdentifier}.svg`;
}

export default class CachedOsuFlagsFetcher {
    private readonly _httpRequestTimeout: number;
    private readonly _cacheSeconds: number;
    private readonly _osuSvgDensityFactor: number;
    private readonly _redisKeyPrefix: string;
    private readonly _redisClient: CustomRedisType;

    constructor(httpRequestTimeout: number, cacheSeconds: number, osuSvgDensityFactor: number, redisOptions: RedisOptions) {
        this._httpRequestTimeout = httpRequestTimeout;
        this._cacheSeconds = cacheSeconds;
        this._osuSvgDensityFactor = osuSvgDensityFactor;
        this._redisKeyPrefix = redisOptions.keyPrefix;
        this._redisClient = createClient({
            socket: {
                path: redisOptions.socketPath,
                host: redisOptions.host,
                port: redisOptions.port
            },
            database: redisOptions.databae,
            scripts: REDIS_SCRIPTS
        });
    }

    public connectToRedis(): Promise<void> {
        return this._redisClient.connect();
    }

    public disconnectFromRedis(): Promise<void> {
        return this._redisClient.disconnect();
    }

    public async fetchFlagPngBuffer(xx: string, size: number): Promise<Buffer | null> {
        const hashKey = `${this._redisKeyPrefix}:${xx}`;
        const pngFieldName = `png:${size}`;
        const svgFieldName = 'svg';

        let pngBuf = await this._redisClient.hGet(RETBUF, hashKey, pngFieldName);
        if (pngBuf) {
            console.log(`got cached png ${xx} with size ${size}`);
            return pngBuf;
        }

        let svgBuf = await this._redisClient.hGet(RETBUF, hashKey, svgFieldName);
        if (!svgBuf) {
            const url = getOsuFlagSvgUrl(xx);
            console.log(`loading svg ${xx} from ${url}`);
            svgBuf = await this._fetchOrNullOn404OrWrongContentType(url, 'image/svg+xml') ?? EMPTY_BUF;
            await this._redisClient.hSetEx(hashKey, this._cacheSeconds, svgFieldName, svgBuf);
        } else {
            console.log(`got cached svg ${xx}`);
        }

        if (svgBuf.length === 0) {
            console.log(`svg ${xx} does not exist (or has non svg content type)`);
            return null;
        }

        console.log(`building png ${xx} with size ${size}`);
        pngBuf = await this._buildPngFromSvg(svgBuf, size);
        await this._redisClient.hSetOnlyIfKeyExists(hashKey, pngFieldName, pngBuf);
        return pngBuf;
    }

    private _fetchOrNullOn404OrWrongContentType(url: string, expectedContentType: string): Promise<Buffer | null> {
        return new Promise((resolve2, reject2) => {
            let handled = false;
            const resolve = (buf: Buffer | null) => {
                if (handled) return;
                handled = true;
                resolve2(buf);
            }
            const reject = (err: Error) => {
                if (handled) return;
                handled = true;
                reject2(err);
            }

            const req = https.get(url, {
                timeout: this._httpRequestTimeout,
                headers: {
                    'Accept-Encoding': 'br, gzip, deflate'
                }
            });

            req.once('error', err => reject(err));
            req.once('response', res => {
                if (res.statusCode === 404) {
                    return resolve(null);
                }

                if (res.statusCode !== 200) {
                    return reject(new Error(`Unexpected http response ${res.statusCode} ${res.statusMessage}`));
                }

                let contentType = res.headers['content-type'];
                if (contentType != expectedContentType) {
                    return resolve(null);
                }

                let readable: Readable;
                let contentEncoding = res.headers['content-encoding'];
                switch (contentEncoding) {
                    case undefined:
                        // no content encoding
                        readable = res;
                        break;
                    case 'gzip':
                        // gzip compression
                        readable = res.pipe(zlib.createGunzip());
                        break;
                    case 'br':
                        // brotli compression
                        readable = res.pipe(zlib.createBrotliDecompress());
                        break;
                    case 'deflate':
                        // deflate compression
                        readable = res.pipe(zlib.createInflate());
                        break;
                    default:
                        // unknown
                        return reject(new Error(`unknown content encoding (${contentEncoding}) in api response`));
                }

                let totalDataLength = 0;
                let chunks: Buffer[] = [];
                readable.once('error', err => reject(err));
                readable.once('end', () => {
                    const data = Buffer.concat(chunks, totalDataLength);
                    return resolve(data);
                });
                readable.on('data', chunk => {
                    if (!Buffer.isBuffer(chunk)) {
                        return;
                    }
                    totalDataLength += chunk.length;
                    chunks.push(chunk);
                });
            });
        });
    }

    private _buildPngFromSvg(svgBuf: Buffer, size: number): Promise<Buffer> {
        const density = this._osuSvgDensityFactor * size;
        return sharp(svgBuf, { density }).resize(size).png().toBuffer();
    }
}

