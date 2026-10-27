RPX CASE ACTIVITY API
=====================

Overview
--------

The RPX Case Activity API provides real-time case activity information, such
as which users are viewing or editing a case. Activity data is stored in Redis
with a short configurable lifetime.

The service is an Express and Node.js application. It provides endpoints for
adding activity and retrieving activity for one or more cases, and includes
authentication, request validation, CORS controls, Redis health checks,
structured logging and scheduled store clean-up.


Prerequisites
-------------

- Node.js 20.20.2, as specified by .nvmrc. package.json accepts Node.js
  versions in the ^20.11.0 range.
- Yarn 4.18.0, as specified by package.json.
- Docker, if you need a local Redis instance.
- Access to the HMCTS VPN and approved environment credentials when calling
  shared services.
- Git Bash or WSL on Windows for the Bash and environment-variable examples.

Install the dependencies from the repository root:

    corepack enable
    yarn install


Run the API locally
-------------------

Start the service:

    yarn start

The default local port is 3460. Override it when required:

    PORT=3460 yarn start

The service will be available at:

    http://localhost:3460

The application starts a scheduled clean-up job for expired activity records
unless NODE_ENV is set to test.

For useful development logging, set the environment and DEBUG values before
starting the service:

    export NODE_ENV=dev
    export DEBUG='rpx-case-activity-api:*'
    yarn start

The service loads configuration with node-config. Configuration files are in
config/, including default.yaml, custom-environment-variables.yaml and
test.yaml. Environment-specific values and secrets should be supplied through
the approved deployment or secret-management process.


Redis for local development
---------------------------

The API requires Redis for normal activity storage and health checks. Start a
local Redis container with Docker:

    docker pull redis
    docker run --name ccd-redis -p 6379:6379 -d redis

The default local configuration connects to Redis at localhost:6379. It uses
the activity: key prefix and the local configuration values for activity and
user-detail expiry.

Check the running container:

    docker ps

Open a Redis command-line session:

    docker exec -it ccd-redis redis-cli

Useful commands include GET, SET, SCAN and DEL. Do not delete keys in a shared
or production Redis instance without following the approved operational
process.

To stop and remove the local container after development:

    docker stop ccd-redis
    docker rm ccd-redis


Health check
------------

The service exposes a health endpoint at:

    http://localhost:3460/health

The health check includes Redis connectivity. A healthy response confirms that
the application can answer the request and that the configured Redis check is
passing; it does not prove that every consumer or dependent service is
working.

After starting the API:

1. Check /health.
2. Check the application logs for Redis connection errors.
3. Confirm that the expected Redis host, port, TLS setting and password are
   loaded for the selected environment.
4. Exercise a read-only activity request where an approved test case is
   available.


API routes
----------

Add activity for one case:

    POST /cases/:caseid/activity

Retrieve activity for one or more cases:

    GET /cases/:caseids/activity

Multiple case IDs are supplied as a comma-separated path value. The service
validates case IDs before processing requests and applies the configured
request timeout.

Requests are subject to the service's authentication and role rules. The
default configuration allows caseworker-style users and blocks solicitor
users; confirm the environment-specific security configuration before testing
with a real account.


Configuration and secrets
-------------------------

The application uses node-config and properties-volume integration. Important
settings include:

- Redis host, port, TLS setting, key prefix and password.
- Redis activity and user-detail expiry values.
- IDAM base URL and authentication settings.
- CORS origin whitelist and allowed methods.
- Application request timeout and clean-up schedule.
- Application Insights enablement and connection settings.

Local default values are intended for development and tests only. Never use
the local Redis password or development credentials in a shared environment.
Do not commit passwords, tokens, connection strings or other live secrets.


Run unit tests
--------------

Run the unit tests:

    yarn test

Run the tests with coverage:

    yarn test:coverage

Coverage reports are written under coverage/ and include LCOV and text
summary output.


Run end-to-end tests
--------------------

End-to-end tests require a running Redis instance:

    yarn test:end2end

The end-to-end test configuration uses NODE_ENV=test. Test setup removes Redis
keys before each test, so use an isolated local or test Redis instance only.
Never point these tests at a shared or production Redis instance unless the
test process has been explicitly approved for that environment.


Run functional tests
--------------------

Functional tests are in the aat/ directory and use the BEFTA framework:

    yarn test:functional

To invoke the Gradle task directly:

    cd aat
    ./gradlew functional

Functional tests require the relevant environment, credentials, service
access and any supporting HMCTS applications defined by the AAT test setup.


Linting and security checks
---------------------------

Run the JavaScript lint checks:

    yarn lint

Apply the available automatic lint fixes:

    yarn lint-fix

Run the dependency audit against the repository's known-audit baseline:

    yarn test:audit

Run the Fortify scan through the AAT Gradle project:

    yarn fortifyScan

Run Sonar analysis when the required Sonar environment is available:

    yarn sonar-scan


Development workflow
--------------------

1. Create a focused branch.
2. Install dependencies with yarn install.
3. Start an isolated local Redis instance.
4. Start the API with yarn start.
5. Check /health and review logs.
6. Run targeted unit tests and lint checks.
7. Run end-to-end tests against the isolated Redis instance.
8. Run functional tests only when the required AAT environment is available.
9. Review generated coverage and test output before opening a pull request.


Operational troubleshooting
---------------------------

The API does not start

- Check the Node.js and Yarn versions.
- Run corepack enable and yarn install.
- Check that the selected configuration file is valid YAML.
- Check that the configured port is free.

Port 3460 is already in use

- Stop the conflicting process, or start the API with an approved PORT value.
- Update health checks and test clients to use the new port.

Redis connection fails

- Confirm that the ccd-redis container is running.
- Check the configured Redis host and port.
- Check TLS and password settings for the selected environment.
- Confirm that local tests are not using a shared Redis instance.

Health check is unhealthy

- Check Redis connectivity first.
- Review the application and Redis client logs.
- Confirm that a shutdown or restart is not in progress.

Requests are rejected

- Check the bearer token and user role.
- Check the configured IDAM base URL and authentication settings.
- Check that the case ID is numeric and that multiple IDs are comma-separated.
- Check CORS settings when the caller is a browser application.

Activity disappears unexpectedly

- Check the configured activity TTL and user-detail TTL.
- Confirm that the clean-up job is not removing records earlier than intended.
- Check that the expected Redis key prefix is being used.


Deployment and infrastructure
-----------------------------

The repository includes Helm configuration under charts/xui-case-activity-api
and Terraform infrastructure under infrastructure/. The deployment uses an
environment-specific Redis service and injects configuration through
environment variables and secret management.

Before deploying:

- Confirm the target environment and approved image or package version.
- Confirm Redis host, port, TLS and secret configuration.
- Confirm CORS and IDAM settings.
- Run the relevant unit, end-to-end, functional and security checks.
- Confirm the health endpoint after deployment.
- Check a read-only activity journey before testing any write operation.
- Record the version, environment, deployment time and outcome.

Do not make manual production changes to Redis or secret values outside the
approved HMCTS deployment and incident processes.


UK English and technical terminology
-------------------------------------

Use UK English in documentation, test descriptions and support responses.
Preferred spellings include:

    authorise / authorisation
    behaviour
    centre
    colour
    customise / customisation
    licence (noun) / license (verb)
    analyse / analysed
    catalogue
    prioritise

Keep technical identifiers, package names, API fields, route names, Redis keys
and external service names unchanged where their spelling is part of a
technical contract.


Licence
-------

This project is licensed under the MIT Licence. See the repository licence
file for the full text.
