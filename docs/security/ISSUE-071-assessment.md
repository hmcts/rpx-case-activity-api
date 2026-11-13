# ISSUE-071 / EXUI-4193: missing case-level authorization

Assessed on 11 November 2026 against `exui-4997-web-pubsub-approach-AT`, starting
commit `243e255`.

## Disposition: true positive; fix implemented, live AT validation outstanding

The REST endpoints already invoke the case access checker. The Web PubSub router
bypassed it: `watch` accepted arbitrary case IDs, joined their groups, read activity,
and returned viewer/editor identities. `view` and `edit` also joined arbitrary
case groups and wrote presence. Authenticated users with a whitelisted role could
therefore monitor activity on cases they could not access in CCD.

Evidence is in `app/web-pubsub/router.js`, `service/handlers.js` and
`service/activity-service.js`. The latter returns viewer/editor IDs, forenames and
surnames. Transport authentication and a role whitelist do not establish access
to a particular case.

The attachment's claim about a duplicate repository was not independently verified.
Here REST uses `case:`/`user:` Redis keys and Web PubSub uses `c:`/`u:`/`s:`.

## Remediation

- Check every `watch`, `view` and `edit` case ID before calling handlers, joining
  groups, reading identities, or writing presence. Reject a mixed allowed/denied
  watch batch in full. Validate IDs and encode CCD path components.
- Reuse the existing CCD checker with the caller's Authorization header and the
  proxy's ServiceAuthorization header when supplied. CCD 403/404 becomes 403;
  network/upstream failures and redirects deny access. Bound each lookup to five
  seconds so a stalled CCD request cannot indefinitely block a Web PubSub event.
- Store authenticated identity and credentials in Redis under a random session
  reference. Keep the credentials out of the negotiated URL and connection state.
  Match the stored user to Azure's token user ID on connect and protected events;
  ignore client-supplied user claims.
- Expire server sessions at the earlier of one hour and the available JWT
  credentials' expiration times. Opaque credentials use the one-hour cap and are
  still checked by CCD. Close the connection at expiration to trigger the existing
  toolkit reconnect/renegotiation flow, rather than leaving it connected with
  permanently rejected messages. Clear the expiry timer on disconnect.
- Preserve REST error objects so Express retains authorization and dependency
  failure status codes. Carry the optional service credential through REST too.

## Compatibility with the supplied frontend and toolkit PRs

Inspected the exact GitHub PR heads through the GitHub API and raw source:

- [XUI PR #5315](https://github.com/hmcts/rpx-xui-webapp/pull/5315), commit
  `6e682485f6402a3c1f53e2cbe9097e23164fa2ca`.
- [Toolkit PR #2230](https://github.com/hmcts/ccd-case-ui-toolkit/pull/2230), commit
  `ce2ca308052c03078b101b0e4ec5616f558e54b2`.

XUI proxies `/web-pubsub/negotiate` without rewriting the response. The toolkit's
`ActivitySocketService.getSharedClient()` returns `connection.url` verbatim from
its negotiation callback. The new opaque query reference therefore requires no
frontend code change for these PR versions.

The event names `watch`, `view`, `edit`, `stop` and `stopAll`, their `caseId`/`caseIds`
payloads and JSON encoding are preserved. Server/group messages still contain
`{ event: 'activity', data: [...] }`, with the existing viewer/editor fields.
Hub name, middleware path, Redis activity formats, broadcast debounce, presence
refresh and cleanup behavior are retained. Negotiation grants no client roles for
joining arbitrary groups or publishing to groups.

The toolkit already handles disconnection and restarts after `stopped`, invoking
its URL negotiation callback again. The case-view and edit components reissue
presence when connected; search results reissue their watch. Credential expiration
now uses that flow; authorized users may see a brief reconnect. A denied or
unverifiable case request intentionally receives an error instead of activity.

An isolated execution harness transpiled the exact downloaded toolkit transport
class with Node's TypeScript transformer, real RxJS and mocked Angular/browser and
Azure client interfaces. It verified the full negotiated URL, all five outgoing
event frames, incoming server/group activity parsing, and a fresh negotiation
following disconnect/stopped. This was a compatibility check, not the complete
Angular test suite or a connection to live Azure.

## Regression evidence

- `test/spec/app/web-pubsub/message-contract.spec.js` exercises negotiation, the
  real Azure HTTP upstream middleware, router, checker and handlers. It verifies
  watch snapshots, view/edit broadcasts, successful acknowledgements, stop and
  stopAll group cleanup, denied subscriptions and fresh connections after reconnect.
  Azure service operations, CCD responses and activity storage are mocked.
- `case-authorization.spec.js` verifies that all protected events reject CCD
  403/404/500 before handler or group access, that mixed batches disclose nothing,
  and that redirects/network failures fail closed.
- `router-authentication.spec.js` covers server identity, credential forwarding,
  missing/expired/mismatched sessions, expiry closure, timer cleanup and waiting
  for authorization before acknowledging or processing an event.
- Session tests cover credential expiry and opaque references. REST and user
  middleware regression tests cover status preservation and service credentials.

Validation: all 278 unit tests passed on Node 24.22.1. Application lint, lint on
the new test files and updated router tests, and `git diff --check` passed. The
isolated toolkit transport compatibility harness also passed.

## Rollout and remaining limits

Keep `RPX_CASE_ACCESS_CHECK_ENABLED=true`, as configured in deployment values.
Disabling it intentionally bypasses case checks; legacy tests disable it, while
security tests explicitly enable it. Keep `RPX_BASE_URL` pointed at CCD and ensure
XUI's service credential is accepted by CCD. No new service secret is generated.

Validate in AT with two users having different case permissions: normal viewing,
editing, search watches, navigation, reconnect, credential renewal and mixed/denied
requests. Existing connections without session state must renegotiate during the
rollout; drain connections that may retain pre-fix subscriptions.

Case authorization occurs on protected client events. This change does not add
continuous revalidation of group membership when case permissions change. Expiry
closure is scheduled by the process that accepts the connection; process loss can
lose that timer. Subsequent protected events still reject expired sessions and
close the connection, but uninterrupted expiry enforcement across process restarts
would require a distributed connection lifecycle. The full frontend suite and
end-to-end Azure message flow have not been run. No deployment or Jira status
change was made.

## Demo follow-up: 12 November 2026

The deployed `xui-case-activity-api` image `pr-39-732a7a9-20261112131829` returned
502 on both search watches and single-case activity. Read-only inspection found
two integration defects:

1. The running demo HelmRelease omitted `RPX_BASE_URL`. The process resolved its
   CCD base URL to `http://localhost:4000`; probing that endpoint reproduced
   `ECONNREFUSED`. The actual demo CCD health endpoint was reachable with HTTP 200.
2. Case verification omitted CCD's required `experimental` header. The real CCD service returned
   an endpoint-not-found 404 without the `experimental` header. CCD's official
   `v2/external/controller/CaseController.java` requires that header for
   `GET /cases/{caseId}` and produces the case v2 media type.

The checker now sends `experimental: true`. A separate live demo lookup returned
HTTP 200 without an explicit Accept header, so the media-type constant and Accept
header were removed. Local demo Flux values explicitly supply the correct CCD URL
and enable authorization.
Existing Redis and image-policy edits in that checkout were preserved.

Using the affected user's existing server-side session, the corrected lookup
returned HTTP 200. The exact patched checker was then evaluated in memory inside
the demo pod, with its CCD URL overridden to the real demo service: the complete
25-case batch from the reported watch event passed authorization. No credentials,
case bodies, or session references were printed. The running application and
Kubernetes/Flux resources were not modified by these probes.

Regression tests now require `experimental: true` at the mocked CCD boundary, so a
request missing it no longer passes the positive message-contract tests. Safe
failure diagnostics report the upstream origin, status/network code, case count
and service-credential presence, without logging credentials or response bodies.
All access checks and fail-closed behavior remain enabled.

Both the backend build and the demo Flux values must be deployed to resolve the
running demo failure. Setting only the URL would leave the missing-header defect;
deploying only the backend would leave the localhost fallback.
