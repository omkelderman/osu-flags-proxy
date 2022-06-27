# Env Vars
Runtime config

## Constants
the defaults are fine at the time of writing this, only change this if the svg output from osu server changes
* `FLAG_DENSITY`: the density in the svg from osu servers, defaults to 72
* `FLAG_WIDTH`: the width in the svg from osu servers, defaults to 36

## Configuration
### flag output options
* `MAX_SIZE`: the max allowed flag size, defaults to 1000
* `DEFAULT_SIZE`: the default flag size if no size is given in the request, defaults to 128
* `CACHE_SECONDS`: amount of seconds to cache svg from osu servers, defaults to one week
### http request options
* `HTTP_TIMEOUT`: http timeout in ms when doing a http request (to fetch new svg from osu server), defaults to 1000 or one second
### http server options
* `LISTEN`: either a port or a socket path, defaults to 3000
* `LISTEN_HOST`: if `LISTEN` is a port the hostname to listen on, defaults to localhost
* `LISTEN_CHMOD`: if `LISTEN` is a socket path, optionally apply this chmod to the socker after create
### redis options
* `REDIS_SOCKET`: socket path to redis, if specified will use this, otherwise uses the next options
* `REDIS_PORT`: redis port to connect to, if not specified will try to connect to default redis port
* `REDIS_HOST`: optionally the redis host if its not localhost
* `REDIS_PREFIX`: the prefix of all keys, defaults to `osu-flags-proxy`
  
# Dev
Run `npm i` to install all dependencies. Run `npm run build` and `npm run start` to start the program.