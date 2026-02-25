# WODGoat Backend API Endpoints Specification

Base URL: `http://localhost:3000/api` (development) or your production URL

## Authentication
Most endpoints require JWT Bearer token in Authorization header:
```
Authorization: Bearer <accessToken>
```

---

## 🔐 USER ENDPOINTS (`/api/users`)

### 1. Register User
- **POST** `/api/users/register`
- **Auth**: None (public)
- **Input**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe",
  "nickname": "Johnny",
  "mobileNumber": "+1234567890",
  "birthYear": 1990,
  "gender": "male",
  "height": 175,
  "weight": 75,
  "profilePictureUrl": "https://..."
}
```
- **Required**: `email`, `password`, `name`, `birthYear`
- **Output** (201):
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "uid": "firebase_user_id",
    "email": "user@example.com",
    "name": "John Doe",
    "nickname": "Johnny",
    "profilePictureUrl": "https://..."
  }
}
```

### 2. Login User
- **POST** `/api/users/login`
- **Auth**: None (public)
- **Input**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```
- **Output** (200):
```json
{
  "success": true,
  "message": "Login successful",
  "accessToken": "jwt_access_token",
  "refreshToken": "jwt_refresh_token",
  "user": {
    "uid": "firebase_user_id",
    "email": "user@example.com",
    "name": "John Doe",
    "nickname": "Johnny",
    "profilePictureUrl": "https://...",
    "statsSummary": {
      "totalWorkouts": 0,
      "currentStreak": 0,
      "longestStreak": 0,
      "lastWorkoutDate": null,
      "latestPR": {
        "exerciseId": null,
        "exerciseName": null,
        "estimated1RM": 0
      }
    }
  }
}
```

### 3. Refresh Token
- **POST** `/api/users/refresh-token`
- **Auth**: None
- **Input**:
```json
{
  "refreshToken": "jwt_refresh_token"
}
```
- **Output** (200):
```json
{
  "success": true,
  "accessToken": "new_jwt_access_token"
}
```

### 4. Get Profile
- **GET** `/api/users/profile`
- **Auth**: Required
- **Input**: None (user from token)
- **Output** (200):
```json
{
  "success": true,
  "user": {
    "uid": "firebase_user_id",
    "email": "user@example.com",
    "name": "John Doe",
    "nickname": "Johnny",
    "mobileNumber": "+1234567890",
    "birthYear": 1990,
    "gender": "male",
    "height": 175,
    "weight": 75,
    "profilePictureUrl": "https://...",
    "statsSummary": { /* ... */ },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

### 5. Update Profile
- **PUT** `/api/users/profile`
- **Auth**: Required
- **Input** (all optional):
```json
{
  "name": "John Updated",
  "nickname": "JD",
  "mobileNumber": "+9876543210",
  "birthYear": 1991,
  "gender": "male",
  "height": 180,
  "weight": 80,
  "profilePictureUrl": "https://..."
}
```
- **Output** (200):
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "user": { /* updated user object */ }
}
```

### 6. Update Stats Summary
- **PUT** `/api/users/stats`
- **Auth**: Required
- **Input**:
```json
{
  "statsSummary": {
    "totalWorkouts": 50,
    "currentStreak": 7,
    "longestStreak": 14,
    "lastWorkoutDate": "2026-02-20T00:00:00.000Z",
    "latestPR": {
      "exerciseId": "back_squat",
      "exerciseName": "Back Squat",
      "estimated1RM": 150
    }
  }
}
```
- **Output** (200):
```json
{
  "success": true,
  "message": "Stats updated successfully"
}
```

### 7. Logout
- **POST** `/api/users/logout`
- **Auth**: Required
- **Input**: None
- **Output** (200):
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### 8. Get All Users
- **GET** `/api/users?limit=50&startAfter=userId`
- **Auth**: Required
- **Query Params**: `limit` (optional), `startAfter` (optional)
- **Output** (200):
```json
{
  "success": true,
  "users": [ /* array of user objects */ ]
}
```

### 9. Get User By ID
- **GET** `/api/users/:userId`
- **Auth**: Required
- **Output** (200):
```json
{
  "success": true,
  "user": { /* user object */ }
}
```

---

## 💪 WORKOUT ENDPOINTS (`/api/workouts`)

### 1. Create Workout
- **POST** `/api/workouts`
- **Auth**: Required
- **Note**: Exercises must reference valid exercise IDs from the exercise library (`/api/exercises`)
- **Input**:
```json
{
  "scheduledFor": "2026-02-25T10:00:00.000Z",
  "notes": "Focus on form",
  "groupId": "group_id_or_null",
  "wods": [
    {
      "name": "Strength Work",
      "exercises": [
        {
          "exerciseId": "exercise_back_squat_id",
          "name": "Back Squat",
          "instructions": "5 sets x 5 reps @ 80%",
          "trackingType": "weight_reps"
        },
        {
          "exerciseId": "exercise_leg_press_id",
          "name": "Leg Press",
          "instructions": "3 sets x 12 reps",
          "trackingType": "weight_reps"
        }
      ]
    },
    {
      "name": "Metcon",
      "exercises": [
        {
          "exerciseId": "exercise_running_id",
          "name": "Running",
          "instructions": "400m sprint",
          "trackingType": "time_distance"
        }
      ]
    }
  ]
}
```
- **Required**: `scheduledFor`, `wods` (non-empty array)
- **Exercise Fields**: Each exercise must have `exerciseId`, `name`, `instructions`, `trackingType`
- **Output** (201):
```json
{
  "success": true,
  "message": "Workout created successfully",
  "data": {
    "id": "workout_doc_id",
    "assignedBy": "user_id",
    "groupId": null,
    "assignedAt": "2026-02-21T00:00:00.000Z",
    "scheduledFor": "2026-02-25T10:00:00.000Z",
    "completed": false,
    "completedAt": null,
    "notes": "Focus on form",
    "wods": [ /* array of WOD objects with exercises */ ],
    "results": []
  }
}
```

### 2. Get All Workouts
- **GET** `/api/workouts?limit=20`
- **Auth**: Required
- **Query Params**: `limit` (optional, max 100)
- **Output** (200):
```json
{
  "success": true,
  "count": 5,
  "data": [ /* array of workout objects */ ]
}
```

### 3. Get Workouts By Status
- **GET** `/api/workouts/status?completed=false`
- **Auth**: Required
- **Query Params**: `completed` (boolean: `true` or `false`)
- **Output** (200):
```json
{
  "success": true,
  "count": 3,
  "data": [ /* array of workout objects */ ]
}
```

### 4. Get Workout By ID
- **GET** `/api/workouts/:workoutId`
- **Auth**: Required
- **Output** (200):
```json
{
  "success": true,
  "data": { /* workout object */ }
}
```

### 5. Complete Workout
- **POST** `/api/workouts/:workoutId/complete`
- **Auth**: Required
- **Input**:
```json
{
  "results": [
    {
      "wodIndex": 0,
      "exerciseIndex": 0,
      "reps": 5,
      "weight": 100,
      "timeInSeconds": null,
      "distanceMeters": null
    },
    {
      "wodIndex": 0,
      "exerciseIndex": 1,
      "reps": 12,
      "weight": 200,
      "timeInSeconds": null,
      "distanceMeters": null
    },
    {
      "wodIndex": 1,
      "exerciseIndex": 0,
      "reps": null,
      "weight": null,
      "timeInSeconds": 90,
      "distanceMeters": 400
    }
  ]
}
```
- **Output** (200):
```json
{
  "success": true,
  "message": "Workout marked as completed"
}
```

### 6. Update Workout
- **PUT** `/api/workouts/:workoutId`
- **Auth**: Required
- **Input** (all optional):
```json
{
  "scheduledFor": "2026-02-26T10:00:00.000Z",
  "notes": "Updated notes",
  "wods": [ /* updated WODs with exercises */ ]
}
```
- **Output** (200):
```json
{
  "success": true,
  "message": "Workout updated successfully"
}
```

### 7. Delete Workout
- **DELETE** `/api/workouts/:workoutId`
- **Auth**: Required
- **Output** (200):
```json
{
  "success": true,
  "message": "Workout deleted successfully"
}
```

---

## 🏆 PERSONAL RECORD ENDPOINTS (`/api/personal-records`)

**Note**: The `exerciseId` field references the exercise library and must match an existing exercise ID (e.g., `back_squat`, `deadlift`). Personal records are stored per user with the exerciseId as the document ID.

### 1. Create/Update Personal Record (Upsert)
- **POST** `/api/personal-records`
- **Auth**: Required
- **Input**:
```json
{
  "exerciseId": "back_squat",
  "exerciseName": "Back Squat",
  "trackingType": "weight_reps",
  "bestWeight": 150,
  "bestReps": 5,
  "bestEstimated1RM": 165,
  "bestTimeInSeconds": null
}
```
- **Required**: `exerciseId`, `exerciseName`, `trackingType`
- **Types**: `weight_reps`, `reps`, `time`, `distance`, `calories`
- **Output** (201):
```json
{
  "success": true,
  "message": "Personal record saved successfully",
  "data": {
    "exerciseId": "back_squat",
    "exerciseName": "Back Squat",
    "trackingType": "weight_reps",
    "bestWeight": 150,
    "bestReps": 5,
    "bestEstimated1RM": 165,
    "bestTimeInSeconds": null,
    "achievedAt": "2026-02-21T00:00:00.000Z",
    "lastUpdatedAt": "2026-02-21T00:00:00.000Z"
  }
}
```

### 2. Get All Personal Records
- **GET** `/api/personal-records?limit=50`
- **Auth**: Required
- **Query Params**: `limit` (optional, max 100)
- **Output** (200):
```json
{
  "success": true,
  "count": 8,
  "data": [ /* array of personal record objects */ ]
}
```

### 3. Get Personal Record By Exercise
- **GET** `/api/personal-records/:exerciseId`
- **Auth**: Required
- **Example**: `/api/personal-records/back_squat`
- **Output** (200):
```json
{
  "success": true,
  "data": { /* personal record object */ }
}
```

### 4. Update Personal Record
- **PUT** `/api/personal-records/:exerciseId`
- **Auth**: Required
- **Example**: `/api/personal-records/back_squat`
- **Input** (all optional):
```json
{
  "exerciseName": "Back Squat Updated",
  "trackingType": "weight_reps",
  "bestWeight": 160,
  "bestReps": 5,
  "bestEstimated1RM": 175,
  "bestTimeInSeconds": null,
  "achievedAt": "2026-02-21T00:00:00.000Z"
}
```
- **Output** (200):
```json
{
  "success": true,
  "message": "Personal record updated successfully"
}
```

### 5. Delete Personal Record
- **DELETE** `/api/personal-records/:exerciseId`
- **Auth**: Required
- **Example**: `/api/personal-records/back_squat`
- **Output** (200):
```json
{
  "success": true,
  "message": "Personal record deleted successfully"
}
```

---

## 👥 GROUP ENDPOINTS (`/api/groups`)

### 1. Create Group
- **POST** `/api/groups`
- **Auth**: Required
- **Input**:
```json
{
  "name": "CrossFit Warriors",
  "memberIds": ["user_id_1", "user_id_2"]
}
```
- **Required**: `name`
- **Output** (201):
```json
{
  "success": true,
  "message": "Group created successfully",
  "data": {
    "groupId": "group_doc_id",
    "name": "CrossFit Warriors",
    "createdBy": "creator_user_id",
    "memberIds": ["creator_user_id", "user_id_1", "user_id_2"],
    "createdAt": "2026-02-21T00:00:00.000Z"
  }
}
```

### 2. Get My Groups (Created By Me)
- **GET** `/api/groups/my-groups`
- **Auth**: Required
- **Output** (200):
```json
{
  "success": true,
  "data": [ /* array of group objects */ ]
}
```

### 3. Get Member Groups (I'm a Member)
- **GET** `/api/groups/member-groups`
- **Auth**: Required
- **Output** (200):
```json
{
  "success": true,
  "data": [ /* array of group objects */ ]
}
```

### 4. Get Group By ID
- **GET** `/api/groups/:groupId`
- **Auth**: Required
- **Output** (200):
```json
{
  "success": true,
  "data": { /* group object */ }
}
```

### 5. Update Group
- **PUT** `/api/groups/:groupId`
- **Auth**: Required
- **Input**:
```json
{
  "name": "Updated Group Name"
}
```
- **Output** (200):
```json
{
  "success": true,
  "message": "Group updated successfully"
}
```

### 6. Add Member to Group
- **POST** `/api/groups/:groupId/members`
- **Auth**: Required
- **Input**:
```json
{
  "userId": "user_id_to_add"
}
```
- **Output** (200):
```json
{
  "success": true,
  "message": "Member added successfully"
}
```

### 7. Remove Member from Group
- **DELETE** `/api/groups/:groupId/members/:userId`
- **Auth**: Required
- **Output** (200):
```json
{
  "success": true,
  "message": "Member removed successfully"
}
```

### 8. Delete Group
- **DELETE** `/api/groups/:groupId`
- **Auth**: Required
- **Output** (200):
```json
{
  "success": true,
  "message": "Group deleted successfully"
}
```

---

## 🏋️ EXERCISE ENDPOINTS (`/api/exercises`)

**Note**: Standard exercises use predefined IDs (e.g., `back_squat`, `deadlift`, `pull_up`) that match the `id` field in `data/standardExercises.json`. These IDs are human-readable and consistent across frontend and backend. Custom exercises created via API will have Firebase auto-generated IDs.

### 1. Create Custom Exercise
- **POST** `/api/exercises`
- **Auth**: Required
- **Input**:
```json
{
  "name": "Single Arm Dumbbell Row",
  "category": "strength",
  "trackingType": "weight_reps",
  "description": "Pull dumbbell to hip with elbow close to body",
  "muscleGroups": ["back", "biceps", "core"]
}
```
- **Required**: `name`, `category`, `trackingType`
- **Categories**: `"strength"`, `"cardio"`, `"gymnastics"`, `"olympic_lifting"`, `"mobility"`, `"other"`
- **Tracking Types**: `"weight_reps"`, `"reps"`, `"time_distance"`, `"calories"`
- **Output** (201):
```json
{
  "success": true,
  "message": "Exercise created successfully",
  "data": {
    "id": "exercise_id",
    "name": "Single Arm Dumbbell Row",
    "category": "strength",
    "trackingType": "weight_reps",
    "description": "Pull dumbbell to hip with elbow close to body",
    "muscleGroups": ["back", "biceps", "core"],
    "isStandard": false,
    "createdBy": "user_id",
    "createdAt": "2026-02-25T10:00:00.000Z",
    "updatedAt": "2026-02-25T10:00:00.000Z"
  }
}
```

### 2. Get All Exercises
- **GET** `/api/exercises`
- **Auth**: Required
- **Query Parameters** (all optional):
  - `category` - Filter by category (e.g., `?category=strength`)
  - `trackingType` - Filter by tracking type (e.g., `?trackingType=weight_reps`)
  - `isStandard` - Filter standard or custom exercises (e.g., `?isStandard=true`)
  - `limit` - Limit results (e.g., `?limit=50`)
- **Output** (200):
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "back_squat",
      "name": "Back Squat",
      "category": "strength",
      "trackingType": "weight_reps",
      "description": "Barbell back squat",
      "muscleGroups": ["legs", "glutes", "core"],
      "isStandard": true,
      "createdBy": null,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "AbC123XyZ",
      "name": "Custom Exercise",
      "category": "other",
      "trackingType": "reps",
      "description": null,
      "muscleGroups": null,
      "isStandard": false,
      "createdBy": "user_id",
      "createdAt": "2026-02-25T10:00:00.000Z",
      "updatedAt": "2026-02-25T10:00:00.000Z"
    }
  ]
}
```

### 3. Search Exercises by Name
- **GET** `/api/exercises/search`
- **Auth**: Required
- **Query Parameters**:
  - `query` - Search term (required)
  - `limit` - Limit results (optional, default: 20)
- **Example**: `/api/exercises/search?query=squat&limit=10`
- **Output** (200):
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "id": "back_squat",
      "name": "Back Squat",
      "category": "strength",
      "trackingType": "weight_reps",
      ...
    },
    {
      "id": "front_squat",
      "name": "Front Squat",
      "category": "strength",
      "trackingType": "weight_reps",
      ...
    }
  ]
}
```

### 4. Get Exercise by ID
- **GET** `/api/exercises/:exerciseId`
- **Auth**: Required
- **Example**: `/api/exercises/back_squat` (uses predefined exercise ID, not Firebase auto-generated ID)
- **Output** (200):
```json
{
  "success": true,
  "data": {
    "id": "back_squat",
    "name": "Back Squat",
    "category": "strength",
    "trackingType": "weight_reps",
    "description": "Barbell back squat",
    "muscleGroups": ["legs", "glutes", "core"],
    "isStandard": true,
    "createdBy": null,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

### 5. Update Exercise
- **PUT** `/api/exercises/:exerciseId`
- **Auth**: Required (only creator can update custom exercises)
- **Note**: Standard exercises cannot be modified
- **Input**:
```json
{
  "name": "Updated Exercise Name",
  "description": "Updated description",
  "muscleGroups": ["legs", "core"]
}
```
- **Output** (200):
```json
{
  "success": true,
  "message": "Exercise updated successfully"
}
```

### 6. Delete Exercise
- **DELETE** `/api/exercises/:exerciseId`
- **Auth**: Required (only creator can delete)
- **Note**: Standard exercises cannot be deleted
- **Output** (200):
```json
{
  "success": true,
  "message": "Exercise deleted successfully"
}
```

---

## ⚠️ ERROR RESPONSES

All endpoints may return error responses in this format:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message (optional)"
}
```

Common HTTP status codes:
- `400` - Bad Request (validation errors, missing fields)
- `401` - Unauthorized (invalid/expired token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error (server-side errors)

---

## 📝 NOTES

1. **Token Expiry**: Access tokens expire in 15 minutes. Use refresh token endpoint to get new access token.
2. **Date Format**: All dates are in ISO 8601 format (e.g., `2026-02-21T10:00:00.000Z`)
3. **Exercise Library**: Workouts reference exercises from the global exercise library. Create/search exercises first, then use their IDs in workout creation.
4. **Subcollections**: Personal records and workouts are stored as subcollections under each user
5. **Auto-Login**: After registration, users need to call login separately to get tokens
6. **Bearer Token**: Include `Authorization: Bearer <accessToken>` header for protected routes
7. **Personal Records**: Automatically created/updated when workouts are completed. Tracks both actual 1RM (single rep) and estimated 1RM (calculated from weight/reps).
