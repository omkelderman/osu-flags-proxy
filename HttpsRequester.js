// pulled le random file from another project I had and modified it a bit, is a bit overkill for what we're doing here but whatever yolo

const zlib = require('zlib');
const https = require('https');

// the stream dependency here is only being used by jsDoc lol, so when I hover over 
// a thing in this file I can see what it does xD
// I honestly should just use typescript lmao
// eslint-disable-next-line no-unused-vars
const stream = require('stream');

let ZLIB_AVAILABLE_ENCODINGS = [];
if (zlib.createBrotliDecompress) {
    ZLIB_AVAILABLE_ENCODINGS.push('br');
}
if (zlib.createGunzip) {
    ZLIB_AVAILABLE_ENCODINGS.push('gzip');
}
if (zlib.createInflate) {
    ZLIB_AVAILABLE_ENCODINGS.push('deflate');
}


class HttpsRequester {
    /**
     * @param {number} httpTimeout
     */
    constructor(httpTimeout) {
        this.httpGetOptions = {
            timeout: httpTimeout,
            headers: {}
        };
        if (ZLIB_AVAILABLE_ENCODINGS.length > 0) {
            this.httpGetOptions.headers['Accept-Encoding'] = ZLIB_AVAILABLE_ENCODINGS.join(', ');
        }
    }

    /**
     * @param {string} url
     * @param {((err: any, readable: stream.Readable) => void)|undefined} cb
     */
    _doHttpGet(url, cb) {
        https.get(url, this.httpGetOptions, res => {
            if (res.statusCode == 404) {
                return cb(null, null);
            }
            if (res.statusCode != 200) {
                return cb(new Error(`Unexpected http response ${res.statusCode} ${res.statusMessage}`));
            }

            /**
             * @type {stream.Readable}
             */
            let readable;
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
                    return cb(`unknown content encoding (${contentEncoding}) in api response`);
            }

            cb(null, readable);
        });
    }

    /**
     * 
     * @param {*} url 
     * @param {((err: any, data: Buffer|null) => void)|undefined} cb
     */
    httpsGetBuffer(url, cb) {
        this._doHttpGet(url, (err, readable) => {
            if (err) return cb(err);
            if (!readable) return cb(null, null);

            /**
             * @type {Buffer[]}
             */
            let chunks = [];
            let totalDataLength = 0;
            readable.on('data', chunk => {
                totalDataLength += chunk.length;
                chunks.push(chunk);
            });
            readable.once('end', () => {
                let data = Buffer.concat(chunks, totalDataLength);
                cb(null, data);
            });
        });
    }
}

module.exports = HttpsRequester;