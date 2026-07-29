import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  evaluateLeadVerificationRequest,
  outsideLeadVerifierIdentity,
  type LeadVerificationRuntimeRequest,
} from './lead-verification-runtime.js';

const port = Number(process.env.PORT || 8080);
const operatorToken = process.env.OUTSIDE_CLAIM_FACTORY_TOKEN?.trim();
const startedAt = new Date().toISOString();

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  res.end(body);
}

function authorized(req: IncomingMessage): boolean {
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!operatorToken || !supplied) return false;
  const expectedBuffer = Buffer.from(operatorToken);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function readJson(req: IncomingMessage, maxBytes = 256 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/live') {
    sendJson(res, 200, {
      ok: true,
      service: 'outside-lead-claim-factory',
      startedAt,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'GET' && ['/healthz', '/ready'].includes(url.pathname)) {
    sendJson(res, operatorToken ? 200 : 503, {
      ok: Boolean(operatorToken),
      service: 'outside-lead-claim-factory',
      contract: 'dreamnet.lead-verification-decision.v1',
      verifier: outsideLeadVerifierIdentity,
      operatorAuthConfigured: Boolean(operatorToken),
      rawPiiAccepted: false,
      selfVerificationAllowed: false,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/lead-verifications') {
    if (!authorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const request = await readJson(req) as LeadVerificationRuntimeRequest;
      const decision = evaluateLeadVerificationRequest(request);
      sendJson(res, 200, decision);
    } catch (error) {
      sendJson(res, 422, {
        ok: false,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
});

server.headersTimeout = 25_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({
    event: 'service_started',
    service: 'outside-lead-claim-factory',
    port,
    verifierFactoryId: outsideLeadVerifierIdentity.factoryId,
  }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({
    event: 'service_stopping',
    service: 'outside-lead-claim-factory',
    signal,
  }));
  server.close((error) => process.exit(error ? 1 : 0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
