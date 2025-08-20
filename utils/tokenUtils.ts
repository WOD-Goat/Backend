import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface TokenPayload {
  uid: string;
  email: string;
  isTrainer: boolean;
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, process.env.JWT_SECRET!, { 
    expiresIn: '5m'  // TEMPORARY: 5 minutes for testing (normally 24h)
  });
};

export const generateRefreshToken = (): string => {
  return crypto.randomBytes(64).toString('hex');
};

