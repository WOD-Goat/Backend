import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface AuthUser {
  uid: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
      return;
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    req.user = {
      uid: decoded.uid,
      email: decoded.email
    };
    
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token.' 
    });
  }
};

export default authMiddleware;
export { authMiddleware as verifyToken };
