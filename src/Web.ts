import type { Socket } from 'net';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import type CachedOsuFlagsFetcher from './CachedOsuFlagsFetcher';
import { chmod } from 'fs/promises';
import { createServer } from 'http';

interface UnixSocketListenOptions {
    listen: string;
    chmod?: string;
}
interface TcpListenOptions {
    listen: number;
    host: string;
}

export type WebListenOptions = UnixSocketListenOptions | TcpListenOptions;

function isTcpListenOptions(options: WebListenOptions): options is TcpListenOptions {
    return typeof options.listen === 'number';
}

export default class Web {
    private static readonly THA_REGEX = /^\/([A-Za-z]+)(?:-([0-9]+))?\.png$/;
    private readonly _defaultSize: number;
    private readonly _maxSize: number;
    private readonly _server: Server;
    private readonly _listenOptions: WebListenOptions;
    private readonly _osuFlagFetcher: CachedOsuFlagsFetcher;
    private readonly _openConnections: Map<string, Socket> = new Map();

    constructor(defaultSize: number, maxSize: number, osuFlagFetcher: CachedOsuFlagsFetcher, listenOptions: WebListenOptions) {
        this._defaultSize = defaultSize;
        this._maxSize = maxSize;
        this._osuFlagFetcher = osuFlagFetcher;
        this._listenOptions = listenOptions;
        this._server = createServer(this._handleRequest.bind(this));
        this._server.on('connection', this._onNewConnection.bind(this));
    }

    public get address() {
        return this._server.address();
    }

    private _onNewConnection(conn: Socket) {
        const key = `${conn.remoteAddress}:${conn.remotePort}`;
        this._openConnections.set(key, conn);
        conn.once('close', () => {
            this._openConnections.delete(key);
        });
    }

    private _killAllOpenConnections() {
        for (const conn of this._openConnections.values()) {
            conn.destroy();
        }
    }

    private _handleRequest(req: IncomingMessage, res: ServerResponse) {
        console.log(`${req.method} ${req.url}`);
        if (req.method !== 'GET') {
            return this._sendPlainText(res, 405, 'Method Not Allowed');
        }

        if (req.url === '/' || !req.url) {
            return this._sendPlainText(res, 200, `Use /XX-xxx.png where XX is the country code and xxx is the desired output width (it\'s also optional: /XX.png uses ${this._defaultSize}). Exmaple: /NL-64.png or /NL.png`);
        }

        const m = Web.THA_REGEX.exec(req.url);
        if (m) {
            const xx = m[1];
            let size;
            if (m[2] === undefined) {
                size = this._defaultSize;
            } else {
                size = parseInt(m[2], 10);
            }

            if (!xx) {
                return this._sendPlainText(res, 400, `invalid url?`);
            }

            if (isNaN(size) || size <= 0 || size > this._maxSize) {
                return this._sendPlainText(res, 400, `invalid size, you may only pick a size between 1 and ${this._maxSize}`);
            }

            return this._sendFlag(res, xx, size);
        }

        return this._sendPlainText(res, 404, 'Not Found');
    }

    private _sendPlainText(res: ServerResponse, statusCode: number, text: string): void {
        this._sendBuffer(res, statusCode, 'text/plain', Buffer.from(text));
    }
    private _sendBuffer(res: ServerResponse, statusCode: number, contentType: string, buffer: Buffer): void {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        res.end(buffer);
    }

    private _sendFlag(res: ServerResponse, xx: string, size: number): void {
        this._osuFlagFetcher.fetchFlagPngBuffer(xx, size).then(flagPngBuf => {
            if (flagPngBuf) {
                console.log(`sending ${xx} with size ${size}`);
                this._sendBuffer(res, 200, 'image/png', flagPngBuf);
            } else {
                console.log(`flag ${xx} not found on osu server`);
                this._sendPlainText(res, 404, 'Not Found');
            }
        }, err => {
            console.error('error while fetching and/or converting flag image', err);
            this._sendPlainText(res, 500, 'error while converting the image');
        });
    }

    public start(): Promise<void> {
        return new Promise((resolve2, reject2) => {
            let handled = false;
            const resolve = () => {
                if (handled) return;
                handled = true;
                resolve2();
            }
            const reject = (err: Error) => {
                if (handled) return;
                handled = true;
                reject2(err);
            }

            const errHandler = (err: Error) => {
                this._server.off('error', errHandler);
                reject(err);
            };
            this._server.once('error', errHandler);

            const o = this._listenOptions;
            if (isTcpListenOptions(o)) {
                this._server.listen(o.listen, o.host, resolve);
            } else {
                this._server.listen(o.listen, () => {
                    if (o.chmod) {
                        chmod(o.listen, o.chmod).then(resolve, reject);
                    } else {
                        resolve();
                    }
                });
            }
        });
    }

    public stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this._killAllOpenConnections();
            this._server.close(err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}