import {
    ACTUAL_MAX_SIZE,
    CACHE_SECONDS,
    DEFAULT_SIZE,
    DENSITY_FACTOR,
    HTTP_TIMEOUT,
    REDIS_DATABASE,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PREFIX,
    REDIS_SOCKET,
    WEB_LISTEN_OPTIONS
} from './config';
import CachedOsuFlagsFetcher from './CachedOsuFlagsFetcher';
import Web from './Web';
import EventEmitter from 'events';

function waitForSignal(...signals: NodeJS.Signals[]) {
    const eventEmitter = new EventEmitter();
    const p = new Promise<void>(resolve => eventEmitter.once('requestShutdown', () => {
        resolve();
        eventEmitter.on('requestShutdown', () => console.warn(`Already shutting down. Kill process ${process.pid} forcefully to force shutdown`));
    }));
    const reqShutdown = () => eventEmitter.emit('requestShutdown');
    for (const sig of signals) {
        process.on(sig, reqShutdown);
    }
    return p;
}

async function main() {
    const flagsFetcher = new CachedOsuFlagsFetcher(HTTP_TIMEOUT, CACHE_SECONDS, DENSITY_FACTOR, {
        socketPath: REDIS_SOCKET,
        port: REDIS_PORT,
        host: REDIS_HOST,
        keyPrefix: REDIS_PREFIX,
        databae: REDIS_DATABASE
    });
    const web = new Web(DEFAULT_SIZE, ACTUAL_MAX_SIZE, flagsFetcher, WEB_LISTEN_OPTIONS);

    try {
        console.log('pid', process.pid);
        console.log('connecting to redis...');
        await flagsFetcher.connectToRedis();
        console.log('connected to redis!');
        console.log('starting http server...')
        await web.start();
        console.log('http listening', web.address);

        console.log('waiting for shutdown signal...')
        await waitForSignal('SIGTERM', 'SIGINT');
        console.log('shutdown signal received.')
    } catch (err) {
        console.error('uncatched error', err);
    } finally {
        console.log('shutting down http...');
        try {
            await web.stop();
        } catch (err) {
            console.error('error while stopping http server', err);
        }
        console.log('http server stopped');
        console.log('disconnecting from redis...');
        try {
            await flagsFetcher.disconnectFromRedis();
        } catch (err) {
            console.error('error while disconnecting redis', err);
        }
        console.log('disconnected from redis');
    }
}

main();