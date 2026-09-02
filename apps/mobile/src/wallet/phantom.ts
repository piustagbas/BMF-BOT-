import { Buffer } from 'buffer';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export type WalletProviderName = 'phantom' | 'solflare';

type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

function appUrl(): string {
  return 'https://bmf-bot-api.onrender.com';
}

export function walletRedirectUrl(): string {
  return Linking.createURL('wallet/callback');
}

export async function createDappKeyPair(): Promise<KeyPair> {
  const secret = await Crypto.getRandomBytesAsync(32);
  return nacl.box.keyPair.fromSecretKey(new Uint8Array(secret));
}

export function connectWalletUrl(provider: WalletProviderName, dappPublicKey: Uint8Array): string {
  const params = new URLSearchParams({
    app_url: appUrl(),
    dapp_encryption_public_key: bs58.encode(dappPublicKey),
    redirect_link: walletRedirectUrl(),
    cluster: 'mainnet-beta',
  });
  const host =
    provider === 'solflare'
      ? 'https://solflare.com/ul/v1/connect'
      : 'https://phantom.app/ul/v1/connect';
  return `${host}?${params.toString()}`;
}

function sharedSecret(phantomPk: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.box.before(phantomPk, secretKey);
}

export function decryptWalletPayload(
  dataB58: string,
  nonceB58: string,
  theirPublicKeyB58: string,
  secretKey: Uint8Array,
): Record<string, unknown> {
  const opened = nacl.box.open.after(
    bs58.decode(dataB58),
    bs58.decode(nonceB58),
    sharedSecret(bs58.decode(theirPublicKeyB58), secretKey),
  );
  if (!opened) throw new Error('Could not decrypt wallet response');
  return JSON.parse(Buffer.from(opened).toString('utf8')) as Record<string, unknown>;
}

export async function encryptWalletPayload(
  payload: Record<string, unknown>,
  theirPublicKeyB58: string,
  secretKey: Uint8Array,
): Promise<{ nonce: string; payload: string }> {
  const nonce = new Uint8Array(await Crypto.getRandomBytesAsync(24));
  const bytes = nacl.box.after(
    Buffer.from(JSON.stringify(payload), 'utf8'),
    nonce,
    sharedSecret(bs58.decode(theirPublicKeyB58), secretKey),
  );
  return { nonce: bs58.encode(nonce), payload: bs58.encode(bytes) };
}

function base64ToBytes(b64: string): Uint8Array {
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function signAndSendUrl(
  provider: WalletProviderName,
  txBase64: string,
  session: string,
  dappPublicKey: Uint8Array,
  theirPublicKeyB58: string,
  secretKey: Uint8Array,
): Promise<string> {
  const encodedTx = bs58.encode(base64ToBytes(txBase64));
  const encrypted = await encryptWalletPayload(
    { transaction: encodedTx, session, sendOptions: { skipPreflight: false } },
    theirPublicKeyB58,
    secretKey,
  );
  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(dappPublicKey),
    nonce: encrypted.nonce,
    redirect_link: walletRedirectUrl(),
    payload: encrypted.payload,
  });
  const host =
    provider === 'solflare'
      ? 'https://solflare.com/ul/v1/signAndSendTransaction'
      : 'https://phantom.app/ul/v1/signAndSendTransaction';
  return `${host}?${params.toString()}`;
}

export function parseWalletCallback(url: string): {
  error?: string;
  data?: string;
  nonce?: string;
  phantomEncryptionPublicKey?: string;
} {
  const parsed = Linking.parse(url);
  const q = parsed.queryParams ?? {};
  const err =
    typeof q.errorMessage === 'string'
      ? q.errorMessage
      : typeof q.errorCode === 'string'
        ? q.errorCode
        : undefined;
  return {
    error: err,
    data: typeof q.data === 'string' ? q.data : undefined,
    nonce: typeof q.nonce === 'string' ? q.nonce : undefined,
    phantomEncryptionPublicKey:
      typeof q.phantom_encryption_public_key === 'string'
        ? q.phantom_encryption_public_key
        : typeof q.solflare_encryption_public_key === 'string'
          ? q.solflare_encryption_public_key
          : undefined,
  };
}
