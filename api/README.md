# Authentication API

A Node.js Express API with Firebase authentication supporting athletes and trainers.

## Features

- User registration (athletes only)
- User login (both athletes and trainers)
- JWT token authentication
- Firebase Authentication integration
- User type-based routing
- Protected routes middleware

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   - Copy `.env.example` to `.env`
   - Fill in your Firebase configuration details
   - Generate a strong JWT secret

3. **Firebase Setup:**
   - Create a Firebase project
   - Enable Authentication with Email/Password
   - Create a Firestore database
   - Generate a service account key and add the credentials to your `.env` file

4. **Start the server:**
   ```bash
   npm start
   # or for development with auto-reload
   npm run dev
   ```

## API Endpoints

### Authentication

#### Register (POST `/api/auth/register`)
Register a new athlete user.

**Request Body:**
```json
{
  "email": "athlete@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Athlete"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Athlete registered successfully",
  "user": {
    "uid": "firebase_uid",
    "email": "athlete@example.com",
    "firstName": "John",
    "lastName": "Athlete",
    "userType": "athlete"
  }
}
```

#### Login (POST `/api/auth/login`)
Login for both athletes and trainers.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "jwt_token_here",
  "user": {
    "uid": "firebase_uid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "User",
    "userType": "athlete" // or "trainer"
  },
  "redirectUrl": "/athlete-dashboard" // or "/trainer-dashboard"
}
```

#### Get Profile (GET `/api/auth/profile`)
Get current user profile (protected route).

**Headers:**
```
Authorization: Bearer jwt_token_here
```

**Response:**
```json
{
  "success": true,
  "user": {
    "uid": "firebase_uid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "User",
    "userType": "athlete",
    "createdAt": "2025-08-06T..."
  }
}
```

## User Types

- **Athletes**: Created through the registration endpoint
- **Trainers**: Manually added to the database using the helper script

## Adding Trainers

Use the helper script to manually add trainers:

```javascript
// Edit scripts/addTrainer.js with trainer details
node scripts/addTrainer.js
```

## Frontend Integration

When a user logs in successfully, use the `redirectUrl` field to redirect them:
- Athletes: redirect to `/athlete-dashboard`
- Trainers: redirect to `/trainer-dashboard`

Include the JWT token in the Authorization header for protected routes:
```javascript
headers: {
  'Authorization': `Bearer ${token}`
}
```

## Database Structure

Users are stored in Firestore with the following structure:

```json
{
  "uid": "firebase_uid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "User",
  "userType": "athlete" | "trainer",
  "createdAt": "2025-08-06T...",
  "isActive": true
}
```
