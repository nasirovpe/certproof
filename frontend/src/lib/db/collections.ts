import type { ObjectId } from 'mongodb';

export interface ISiweChallenge {
  _id?: ObjectId;
  nonce: string;
  browserBindingHash: string;
  chainId: number;
  issuedAt: Date;
  expiresAt: Date;
  used: boolean;
  usedAt?: Date;
}

export interface ISession {
  _id?: ObjectId;
  sessionTokenHash: string;
  walletAddress: string;
  chainId: number;
  issuedAt: Date;
  expiresAt: Date;
  lastActiveAt: Date;
  userAgent?: string;
}

export const COLLECTIONS = {
  CHALLENGES: 'siwe_challenges',
  SESSIONS: 'sessions',
} as const;
