const http = require('http');
const fs = require('fs');
const HttpsRequester = require('./HttpsRequester');
const sharp = require('sharp');
const httpsRequester = new HttpsRequester(1000);

const THA_REGEX = /^\/([A-Za-z]+)(?:-([0-9]+))?\.png$/;

// these 2 constants are properties from the svg's on osu! servers
// we're assuming those properties will never change
// if they do, the output will be kind of fucked up
const OSU_FLAG_DENSITY = 72;
const OSU_FLAG_WIDTH = 36;

const MAX_SIZE = parseInt(process.env.MAX_SIZE, 10) || 1000;
const DEFAULT_SIZE = parseInt(process.env.DEFAULT_SIZE, 10) || 128;

const DENSITY_FACTOR = OSU_FLAG_DENSITY / OSU_FLAG_WIDTH;
// max density is 100,000, so our absolute max allowed size is 100,000/DENSITY_FACTOR
const ACTUAL_MAX_SIZE = Math.min(Math.floor(100_000 / DENSITY_FACTOR), MAX_SIZE);

/**
 * 
 * @param {http.ServerResponse} res 
 * @param {number} statusCode 
 * @param {string} text 
 */
function sendPlainText(res, statusCode, text) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/plain');
    const buf = Buffer.from(text);
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
}

/**
 * 
 * @param {http.ServerResponse} res 
 * @param {string} xx country code
 * @param {number} size 
 */
function sendFlag(res, xx, size) {
    const flagUrl = getOsuFlagUrl(xx);
    console.log(`fetching ${flagUrl}`);
    httpsRequester.httpsGetBuffer(flagUrl, (err, buffer) => {
        if (err) {
            console.error(err);
            return sendPlainText(res, 502, 'error while requesting flag from osu! servers');
        }

        if (!buffer) {
            console.log('flag not found on osu server')
            return sendPlainText(res, 404, 'Not Found');
        }

        const density = DENSITY_FACTOR * size;

        console.log('flag found, resizing')
        sharp(buffer, { density }).resize(size).png().toBuffer().then(buf => {
            console.log(`sending ${xx} with size ${size}`);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Length', buf.length);
            res.end(buf);
        }, err => {
            console.error(err);
            return sendPlainText(res, 500, 'error while converting the image');
        });
    });
}

/**
 * 
 * @param {string} xx country code
 */
function getOsuFlagUrl(xx) {
    xx = xx.toUpperCase();
    const bruh = [...Array(xx.length).keys()].map(i => (xx.charCodeAt(i) + 127397).toString(16)).join('-');
    return `https://osu.ppy.sh/assets/images/flags/${bruh}.svg`;
}

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);
    if (req.method !== 'GET') {
        return sendPlainText(res, 405, 'Method Not Allowed');
    }

    if (req.url === '/') {
        return sendPlainText(res, 200, 'Use /XX-xxx.png where XX is the country code and xxx is the desired output width. Exmaple: /NL-128.png');
    }

    const m = THA_REGEX.exec(req.url);
    if (m) {
        const xx = m[1];
        let size;
        if (m[2] === undefined) {
            size = DEFAULT_SIZE;
        } else {
            size = parseInt(m[2], 10);
        }

        if (!xx) {
            return sendPlainText(res, 400, `invalid url?`);
        }

        if (isNaN(size) || size <= 0 || size > ACTUAL_MAX_SIZE) {
            return sendPlainText(res, 400, `invalid size, max size allowed is ${ACTUAL_MAX_SIZE}`);
        }

        return sendFlag(res, xx, size);
    }

    return sendPlainText(res, 404, 'Not Found');
});



let LISTEN;
if (process.env.LISTEN === undefined) {
    LISTEN = 3000;
} else {
    let port = parseInt(process.env.LISTEN);
    if (isNaN(port)) {
        LISTEN = process.env.LISTEN;
    } else {
        LISTEN = port;
    }
}
const LISTEN_HOST = process.env.LISTEN_HOST || 'localhost';
const LISTEN_CHMOD = process.env.LISTEN_CHMOD;

console.log('pid', process.pid);
if (typeof LISTEN === 'number') {
    server.listen(LISTEN, LISTEN_HOST, () => {
        console.log('listening', server.address());
    });
} else {
    server.listen(LISTEN, () => {
        fs.chmodSync(LISTEN, LISTEN_CHMOD);
        console.log('listening', server.address());
    });
}

process.on('SIGTERM', () => process.emit('requestShutdown'));
process.on('SIGINT', () => process.emit('requestShutdown'));
process.once('requestShutdown', () => {
    console.log('Shutting down...');
    process.on('requestShutdown', () => process.emit(`process ${process.pid} already shutting down`));
    server.close((err) => {
        if (err) return console.error('error while stopping http server', err);
        console.log('http server stopped');
    });
});