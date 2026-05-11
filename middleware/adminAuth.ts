import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AdminRequest extends Request {
  admin?: { role: string; email: string };
}

export function adminAuth(req: AdminRequest, res: Response, next: NextFunction): void {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET!) as any;
    if (decoded.role !== 'admin') {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    req.admin = { role: decoded.role, email: decoded.email };
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid admin token' });
  }
}
