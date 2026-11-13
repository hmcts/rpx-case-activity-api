# rpx-case-activity-api
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://travis-ci.org/hmcts/rpx-case-activity-api.svg?branch=master)](https://travis-ci.org/hmcts/rpx-case-activity-api)
[![codecov](https://codecov.io/gh/hmcts/rpx-case-activity-api/branch/master/graph/badge.svg)](https://codecov.io/gh/hmcts/rpx-case-activity-api)
[![Codacy Badge](https://api.codacy.com/project/badge/Grade/a2c055c7bb9547beb87f7f70e5e642f6)](https://www.codacy.com/app/adr1ancho/rpx-case-activity-api?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=hmcts/rpx-case-activity-api&amp;utm_campaign=Badge_Grade)
[![Known Vulnerabilities](https://snyk.io/test/github/hmcts/rpx-case-activity-api/badge.svg)](https://snyk.io/test/github/hmcts/rpx-case-activity-api)
[![HitCount](http://hits.dwyl.io/hmcts/rpx-case-activity-api.svg)](#ccd-activity-api)
[![Issue Stats](http://issuestats.com/github/hmcts/rpx-case-activity-api/badge/pr)](http://issuestats.com/github/hmcts/rpx-case-activity-api)

Real-time tracking of case activity (viewers, editors,...)

## Quickstart

```
$ git clone https://github.com/hmcts/rpx-case-activity-api.git
$ cd rpx-case-activity-api
$ yarn install
$ yarn start
```

For local development without a running IDAM instance, start the API and a
loopback-only IDAM stub together:

```
$ yarn start:local
```

The stub still requires an `Authorization` header and returns a local user with
the `caseworker-local` role. To run only the stub alongside an API process that
is already running, use `yarn start:idam-stub`.

For local multi-user testing (for example viewer/editor presence), pass distinct
bearer tokens per browser session:

- `Authorization: Bearer local-dev-user:alice`
- `Authorization: Bearer local-dev-user:bob`

The suffix after `local-dev-user:` becomes the local `uid`, so each session is
tracked as a different user in activity lists.

## Setup Redis with Docker
To pull the latest docker image from docker store just type:
```
$ docker pull redis
```
After getting the latest redis you may start your redis image by the following command
```
$ docker run --name ccd-redis -p 6379:6379 -d redis
```
You can connect to redis-cli to manually execute some redis commands by connecting to the interactive terminal of your docker container.
to do this first you need to acquire the container id via the `docker ps` command:
```
fatiho@sardis:~/Documents/hmcts/ws-webstorm/rpx-case-activity-api (RDM-963/RDM-1078)$ docker ps
CONTAINER ID        IMAGE                                                           COMMAND                  CREATED             STATUS                PORTS                    NAMES
ef697aec3454        docker.artifactory.reform.hmcts.net/docker/ccd/ccd-data-store   "/entrypoint.sh --..."   13 days ago         Up 8 days (healthy)   0.0.0.0:4000->4000/tcp   ccd-data-store
e7dc23c65e51        docker.artifactory.reform.hmcts.net/docker/ccd/ccd-postgres     "docker-entrypoint..."   13 days ago         Up 8 days             0.0.0.0:5432->5432/tcp   ccd-postgres
8a1fd6f05643        redis                                                           "docker-entrypoint..."   2 weeks ago         Up 4 days             0.0.0.0:6379->6379/tcp   ccd-redis
```
Once you get the Container Id run the following command with proper container id
```
$ docker exec -it 8a1fd6f05643 /bin/bash
```
Now you are in. You can run `redis-cli` to access the Redis Command Line Interface and execute commands like GET, SET, etc.
See [redis documentation](https://redis.io) for details

## Config

Configuration is achieved through [node-config](https://github.com/lorenwest/node-config).

Deployed environments use the Key Vault secret `activity-managed-redis-connection-string`
to connect to Azure Managed Redis over TLS. The application also accepts this `rediss://`
URL through `REDIS_CONNECTION_STRING`. It takes precedence over the legacy host, port,
and password settings; without it, local development retains the existing Redis defaults.
The deployed chart must mount that secret. Demo already mounts it, so its Redis fix
requires an updated application image without changing the current chart or infrastructure.

## Azure Web PubSub

Clients first call `GET /web-pubsub/negotiate` with their normal Authorization header, then
connect to the returned `url` using the `json.webpubsub.azure.v1` subprotocol.
Use the complete returned URL: its opaque `session` reference binds the connection to
the authenticated caller. Credentials remain in Redis until their JWT expiry or
one hour, whichever comes first. The backend closes expired connections so the
existing toolkit reconnect flow negotiates fresh credentials automatically.

With `RPX_CASE_ACCESS_CHECK_ENABLED=true` (the deployment default), `watch`, `view`,
and `edit` verify access to every requested case through `RPX_BASE_URL/cases/:caseId`
using the caller's Authorization header and the proxy's ServiceAuthorization header
when supplied, before subscribing or changing activity.
A denied case rejects the entire request; verification failures deny access as well.
Keep this check enabled in deployed environments.

The existing activity event contract is retained. Send `view`, `edit`, `watch`, `stop`, and
`stopAll` as Web PubSub events, for example:

```json
{"type":"event","event":"view","dataType":"json","data":{"caseId":"123"}}
```

Activity updates are server messages whose JSON data is:

```json
{"event":"activity","data":[{"caseId":"123","viewers":[],"editors":[]}]}
```

The Web PubSub hub upstream must point to
`https://<service-host>/api/webpubsub/hubs/hub/`. Terraform receives this value through
`web_pubsub_event_handler_url`.

Demo uses the callback URL
`https://rpx-case-activity-api.demo.platform.hmcts.net/api/webpubsub/hubs/hub/`.
The demo Flux values in `cnp-flux-config/apps/xui/rpx-case-activity-api/demo.yaml`
must explicitly set `nodejs.environment.RPX_BASE_URL` to
`http://ccd-data-store-api-demo.service.core-compute-demo.internal` and keep
`RPX_CASE_ACCESS_CHECK_ENABLED: true`. Without the CCD URL, the application falls
back to `localhost:4000` and activity events fail with 502. Case verification uses
CCD's required `experimental: true` header; no explicit Accept header is needed.
The callback ingress in `cnp-flux-config/apps/xui/demo/base` routes only the webhook
and `/health/liveness` to `xui-case-activity-api-nodejs:80`. The existing internal
ingress used by Int1 is retained. The matching `frontends` entry in
`azure-platform-terraform/environments/demo/demo.tfvars` provides the HTTPS gateway route.

Deploy the callback ingress and gateway/DNS configuration first. Verify an OPTIONS
request to the callback with `WebHook-Request-Origin` set to
`rpx-case-activity-api-webpubsub-demo.webpubsub.azure.com` returns a successful status
and the matching `WebHook-Allowed-Origin` header. Then apply the demo hub handler
configuration and verify a browser connection through Azure Web PubSub Live Trace.
Apply the hub configuration from the current infrastructure baseline: the legacy Redis
Terraform on this feature branch must not replace the deployed Managed Redis resources.
Public access on the Web PubSub resource remains disabled; `tunnel:///` is for local
development and must not replace this shared demo handler during deployed testing.


## Unit tests.
The tests can be run using:

```
$ yarn test
```

## End to End tests.

The end to end tests require a running instance of Redis. Beware before each test all keys in Redis are removed.
The tests can be run using:

```
$ yarn test:end2end
```

## Functional Tests.
The functional tests are located in `aat` folder. The tests are written using 
befta-fw library. To find out more about BEFTA Framework, see the repository and its README [here](https://github.com/hmcts/befta-fw).

The tests can be run using:

```
$ yarn test:functional
```

or to run using gradle directly:

```
$ cd ./aat/
$ ./gradlew functional
```

## Some notes on development and test config.
You need to set the NODE_ENV to make use of environment configuration and DEBUG to see the logs when you run the server
`````
$ export NODE_ENV=dev
$ export DEBUG='rpx-case-activity-api:*'
$ yarn start

> rpx-case-activity-api@0.0.2 start /Users/fatiho/Documents/hmcts/ws-webstorm/rpx-case-activity-api
> node ./bin/www

  rpx-case-activity-api:app starting application with environment: dev +0ms
  rpx-case-activity-api:server Listening on port 3000 +19ms
  rpx-case-activity-api:redis-client connected to Redis +7ms
```
