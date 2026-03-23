import express, { Request, Response, NextFunction, Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app: Application = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
import userRoutes from './modules/user/routes';
import workoutRoutes from './modules/workout/routes';
import personalRecordRoutes from './modules/personal-record/routes';
import groupRoutes from './modules/group/routes';
import exerciseRoutes from './modules/exercise/routes';
import voiceWorkoutRoutes from './modules/voice-workout/routes';
import notificationRoutes from './modules/notification/routes';

app.use('/api/users', userRoutes);
app.use('/api/workouts', workoutRoutes);
app.use('/api/personal-records', personalRecordRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/exercises', exerciseRoutes);
app.use('/api/ai', voiceWorkoutRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handling middleware
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
