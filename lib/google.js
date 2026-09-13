const crypto = require('crypto');
const https = require('https');

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function httpsRequestJson(options, bodyString) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function getAccessToken() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const signingInput = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);
  const signatureB64 = signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = signingInput + '.' + signatureB64;
  const body = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt;

  const result = await httpsRequestJson(
    {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );

  if (!result.data || !result.data.access_token) {
    throw new Error('Failed to get Google access token: ' + JSON.stringify(result.data));
  }
  return result.data.access_token;
}

function sheetsRequest(method, path, accessToken, bodyObj) {
  const bodyString = bodyObj ? JSON.stringify(bodyObj) : null;
  return httpsRequestJson(
    {
      hostname: 'sheets.googleapis.com',
      path: path,
      method: method,
      headers: Object.assign(
        { Authorization: 'Bearer ' + accessToken },
        bodyString ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyString) } : {}
      ),
    },
    bodyString
  );
}

async function getValues(spreadsheetId, range, accessToken) {
  const path = '/v4/spreadsheets/' + spreadsheetId + '/values/' + encodeURIComponent(range);
  const result = await sheetsRequest('GET', path, accessToken);
  return (result.data && result.data.values) || [];
}

async function appendValues(spreadsheetId, range, values, accessToken) {
  const path =
    '/v4/spreadsheets/' + spreadsheetId + '/values/' + encodeURIComponent(range) +
    ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
  return sheetsRequest('POST', path, accessToken, { values: [values] });
}

async function updateValues(spreadsheetId, range, values, accessToken) {
  const path =
    '/v4/spreadsheets/' + spreadsheetId + '/values/' + encodeURIComponent(range) +
    '?valueInputOption=USER_ENTERED';
  return sheetsRequest('PUT', path, accessToken, { values: [values] });
}

module.exports = { getAccessToken, getValues, appendValues, updateValues };
