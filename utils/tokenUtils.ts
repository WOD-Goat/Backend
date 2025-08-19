import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface TokenPayload {
  uid: string;
  email: string;
  isTrainer: boolean;
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, process.env.JWT_SECRET!, { 
    expiresIn: '24h' 
  });
};

export const generateRefreshToken = (): string => {
  return crypto.randomBytes(64).toString('hex');
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
};

export const getRefreshTokenExpiry = (): Date => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30); // 30 days
  return expiry;
};
