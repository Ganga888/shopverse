import { calculateJwkThumbprint, exportJWK, generateKeyPair, importPKCS8, importSPKI, type CryptoKey, type JWK } from 'jose';

export interface SigningKeys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  kid: string;
  jwk: JWK;
}

/**
 * Load the RS256 key pair from JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (PEM, synced from Secrets Manager
 * `shopverse/<env>/auth/jwt`). Outside production an ephemeral pair is generated if none is configured.
 */
export async function loadSigningKeys(privatePem: string | undefined, publicPem: string | undefined, allowEphemeral: boolean): Promise<SigningKeys> {
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  if (privatePem && publicPem) {
    privateKey = await importPKCS8(privatePem.replace(/\\n/g, '\n'), 'RS256');
    publicKey = await importSPKI(publicPem.replace(/\\n/g, '\n'), 'RS256', { extractable: true });
  } else if (allowEphemeral) {
    ({ privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true }));
  } else {
    throw new Error('JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production');
  }
  const jwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(jwk);
  return { privateKey, publicKey, kid, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

