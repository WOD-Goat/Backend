# WODGoat Backend API

A comprehensive fitness tracking backend API built with Express, TypeScript, and Firebase. Designed for CrossFit and general fitness applications with workout tracking, personal records, and exercise library management.

## 🚀 Features

- **User Authentication** - JWT-based auth with Firebase
- **Exercise Library** - Global library of standard and custom exercises
- **Workout Management** - Create, track, and complete workouts
- **Personal Records** - Automatic PR tracking with actual and estimated 1RM
- **Group Management** - Create groups and share workouts
- **RESTful API** - Complete REST endpoints with validation

## 📋 Prerequisites

- Node.js >= 18.18.0
- Yarn >= 1.22.0
- Firebase project with Firestore
- Firebase service account credentials

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   cd Backend
   ```

2. **Install dependencies**
   ```bash
   yarn install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   NODE_ENV=development
   JWT_SECRET=your_jwt_secret_here
   
   # Firebase Admin SDK Configuration
   FIREBASE_PROJECT_ID=your_project_id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
   ```

4. **Seed the exercise library** (First time only)
   ```bash
   yarn seed:exercises
   ```
   This will populate the database with 70+ standard exercises including:
   - Strength movements (barbells, dumbbells, kettlebells)
   - Olympic lifting
   - Gymnastics (bodyweight movements)
   - Cardio exercises
   - Mobility work

## 🏃‍♂️ Running the Application

**Development mode:**
```bash
yarn dev
```

**Development with auto-reload:**
```bash
yarn dev:watch
```

**Production build:**
```bash
yarn build
yarn start
```

## 📚 API Documentation

Complete API documentation is available in [API_ENDPOINTS_SPEC.md](API_ENDPOINTS_SPEC.md).

### Quick Reference

**Base URL:** `http://localhost:3000/api`

**Authentication:** Include `Authorization: Bearer <token>` header for protected routes.

### Main Endpoints

- **Users** - `/api/users` - Registration, login, profile management
- **Exercises** - `/api/exercises` - Exercise library CRUD and search
- **Workouts** - `/api/workouts` - Create and track workouts
- **Personal Records** - `/api/personal-records` - PR tracking and history
- **Groups** - `/api/groups` - Group management

## 🏗️ Project Structure

```
Backend/
├── config/
│   └── firebase.ts          # Firebase configuration
├── middleware/
│   └── auth.ts              # JWT authentication middleware
├── modules/
│   ├── exercise/            # Exercise library
│   ├── group/               # Group management
│   ├── personal-record/     # Personal records
│   ├── user/                # User authentication
│   └── workout/             # Workout tracking
├── scripts/
│   └── seedExercises.ts     # Database seeding script
├── types/
│   ├── exercise.types.ts
│   ├── group.types.ts
│   ├── personalrecord.types.ts
│   ├── user.types.ts
│   └── workout.types.ts
├── utils/
│   └── tokenUtils.ts        # JWT utilities
├── app.ts                   # Express app setup
├── package.json
└── tsconfig.json
```

## 🎯 Key Features Explained

### Exercise Library

The system uses a centralized exercise library where:
- **Standard exercises** are predefined (e.g., Back Squat, Deadlift) and cannot be modified
- **Custom exercises** can be created by users for their specific needs
- All workouts reference exercises by ID for consistency

### Personal Records

PRs are automatically tracked when workouts are completed:
- **Actual 1RM**: Recorded when performing 1 rep (e.g., 225 lbs × 1 rep)
- **Estimated 1RM**: Calculated using Epley formula for multiple reps (e.g., 200 lbs × 5 reps = 233 lbs estimated)
- Both values are tracked separately to distinguish proven maxes from calculated potential

### Workout Structure

Workouts contain multiple WODs (Workout of the Day):
```json
{
  "scheduledFor": "2026-02-25T10:00:00.000Z",
  "wods": [
    {
      "name": "Strength Work",
      "exercises": [...]
    },
    {
      "name": "Metcon",
      "exercises": [...]
    }
  ]
}
```

## 🔧 Scripts

- `yarn dev` - Start development server
- `yarn dev:watch` - Start development server with auto-reload
- `yarn build` - Build TypeScript to JavaScript
- `yarn start` - Start production server
- `yarn seed:exercises` - Seed exercise library with standard exercises

## 🚢 Deployment

The application is configured for deployment on Vercel.

1. Install Vercel CLI: `npm i -g vercel`
2. Deploy: `vercel --prod`

Make sure to set environment variables in your Vercel project settings.

## 📝 Database Schema

### Collections

- `exercises` - Global exercise library
- `users/{userId}` - User documents
  - `assignedWorkouts` (subcollection) - User's workouts
  - `personalRecords` (subcollection) - User's PRs
- `groups` - Group documents

## 🔐 Security

- JWT tokens expire after 15 minutes
- Refresh tokens available for extended sessions
- Firebase Admin SDK for backend authentication
- All protected routes require valid authentication tokens

## 🤝 Contributing

1. Follow the existing code structure
2. Use TypeScript strict mode
3. Add proper error handling
4. Update API documentation for new endpoints

## 📄 License

ISC

## 🆘 Support

For issues or questions, please refer to the [API Documentation](API_ENDPOINTS_SPEC.md) or open an issue in the repository.
