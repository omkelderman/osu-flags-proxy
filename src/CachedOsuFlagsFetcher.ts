import type { RedisClientType, RedisModules, RedisFunctions } from '@redis/client';

import sharp from 'sharp';
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

    public async connectToRedis(): Promise<void> {
        await this._redisClient.connect();
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

    private async _fetchOrNullOn404OrWrongContentType(url: string, expectedContentType: string): Promise<Buffer | null> {
        const resp = await fetch(url, {signal: AbortSignal.timeout(this._httpRequestTimeout)});
        if(resp.status == 404) return null;
        if(resp.status != 200) throw new Error(`Unexpected http response ${resp.status} ${resp.statusText}`);
        const arrayBuffer = await resp.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    private _buildPngFromSvg(svgBuf: Buffer, size: number): Promise<Buffer> {
        const density = this._osuSvgDensityFactor * size;
        return sharp(svgBuf, { density }).resize(size).png().toBuffer();
    }
}

