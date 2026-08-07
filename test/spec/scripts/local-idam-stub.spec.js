const { expect } = require('chai');
const { getUserFromAuthorization } = require('../../../scripts/local-idam-stub');

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildJwt(payload) {
  const header = base64UrlEncode({ alg: 'none', typ: 'JWT' });
  const body = base64UrlEncode(payload);
  return `${header}.${body}.`;
}

describe('local-idam-stub', () => {
  it('returns default user for local-dev-token', () => {
    const user = getUserFromAuthorization('Bearer local-dev-token');
    expect(user.uid).to.equal('local-user');
    expect(user.given_name).to.equal('Local');
    expect(user.family_name).to.equal('Caseworker');
  });

  it('returns requested local-dev-user identity from prefixed token', () => {
    const user = getUserFromAuthorization('Bearer local-dev-user:alice');
    expect(user.uid).to.equal('alice');
    expect(user.family_name).to.equal('alice');
  });

  it('extracts user identity from jwt payload claims', () => {
    const token = buildJwt({
      uid: '34a47b31-1b48-4539-a7ab-2560d8c4cc2b',
      given_name: 'sscs',
      family_name: 'dwp',
      name: 'SSCS dwp',
      roles: ['caseworker', 'dwp']
    });

    const user = getUserFromAuthorization(`Bearer ${token}`);

    expect(user.uid).to.equal('34a47b31-1b48-4539-a7ab-2560d8c4cc2b');
    expect(user.given_name).to.equal('sscs');
    expect(user.family_name).to.equal('dwp');
    expect(user.name).to.equal('SSCS dwp');
    expect(user.roles).to.deep.equal(['caseworker', 'dwp']);
  });

  it('infers names from sub when name claims are missing', () => {
    const token = buildJwt({ sub: 'SSCS-dwp-cw4@justice.gov.uk' });
    const user = getUserFromAuthorization(`Bearer ${token}`);

    expect(user.uid).to.equal('SSCS-dwp-cw4-justice-gov-uk');
    expect(user.given_name).to.equal('SSCS');
    expect(user.family_name).to.equal('dwp');
  });

  it('does not leak arbitrary bearer token content into user identity', () => {
    const user = getUserFromAuthorization('Bearer definitely-not-a-jwt');
    expect(user.uid).to.equal('local-user');
    expect(user.family_name).to.equal('Caseworker');
  });
});
