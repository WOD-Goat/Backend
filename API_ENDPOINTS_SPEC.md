# WODGoat Backend API Endpoints Specification

Base URL: `http://localhost:3000/api` (development) or your production URL

## Authentication
Most endpoints require JWT Bearer token in Authorization header:
```
Authorization: Bearer <accessToken>
```

## Tracking Types & Measurement Units

The system supports the following tracking types for exercises:

- **`weight_reps`**: For strength exercises (e.g., squats, deadlifts)
  - Tracks: `weight` (lbs/kg), `reps` (number)
  
- **`reps`**: For bodyweight exercises (e.g., pull-ups, push-ups)
  - Tracks: `reps` (number)
  
- **`time`**: For time-based exercises (e.g., stretching, foam rolling, holds)
  - Tracks: `timeInSeconds` (seconds)
  
- **`distance`**: For distance-only exercises (e.g., sled push/pull, farmers carry)
  - Tracks: `distanceMeters` (meters)
  
- **`pace`**: For cardio exercises with both time and distance (e.g., running, rowing, biking)
  - Tracks: `timeInSeconds` (seconds), `distanceMeters` (meters)
  
- **`calories`**: For calorie-based exercises (e.g., assault bike)
  - Tracks: `calories` (number)

**Measurement Units:**
- **Time**: seconds (`timeInSeconds`)
- **Distance**: meters (`distanceMeters`)
- **Weight**: lbs or kg (`weight`)
- **Reps**: count (`reps`)
- **Calories**: count (`calories`)

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
      "completedWorkouts": 0,
      "currentStreak": 0,
      "longestStreak": 0,
      "lastWorkoutDate": null,
      "latestPR": {
        "exerciseId": null,
        "exerciseName": null,
        "value": null,
      },
      "totalPRs": null,
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
    "completedWorkouts": 50,
    "currentStreak": 7,
    "longestStreak": 14,
    "lastWorkoutDate": "2026-02-20T00:00:00.000Z",
    "latestPR": {
      "exerciseId": "back_squat",
      "exerciseName": "Back Squat",
      "value": 150
    },
    "totalPRs":4,
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
          "trackingType": "pace"
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
- **Tracking Types**: `"weight_reps"`, `"reps"`, `"time"`, `"distance"`, `"pace"`, `"calories"`
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

## 📅 PROGRAM ENDPOINTS (`/api/programs`)

Programs are coach-authored, day-numbered plans (`dayNumber` 1..`durationDays`). Athletes join with a join code and a chosen `startDate`; the athlete's current day is computed on read from `startDate` (calendar-based, in the user's `timezone`, default `Africa/Cairo`). Nothing is stored per day.

Conventions for this section:
- All routes require `Authorization: Bearer <accessToken>`. Missing token returns `401` `Access denied. No token provided.`; invalid token returns `401` `Invalid token.` These are not repeated below.
- **Program admin** = the caller's uid is in the program's `adminIds` (the creator plus any co-admins). Routes marked "Admin (middleware)" use `requireProgramAdmin`, which returns `404` `Program not found` if the program does not exist and `403` `Only program admins can perform this action` if the caller is not an admin. Those two errors are not repeated per route.
- **Member** = a doc exists at `programs/{id}/members/{uid}` (created by joining). Admins are not members unless they also joined.
- Any unhandled failure returns `500` `{ "success": false, "message": "<route specific text>", "error": "<detail>" }`. The 500 message is listed per route.
- Route order matters in Express: `/by-code/:code`, `/join`, `/my-programs`, `/member-programs` and `/activity/this-week` are registered before `/:id`.

### 1. Create Program
- **POST** `/api/programs`
- **Auth**: Required (any authenticated user; there is no coach check)
- **Input**:
```json
{
  "name": "12 Week Strength",
  "description": "Optional text",
  "durationDays": 84
}
```
- **Required**: `name` (non-empty string, trimmed), `durationDays` (parsed with `parseInt`, must be a finite number >= 1)
- **Output** (201):
```json
{
  "success": true,
  "message": "Program created successfully",
  "data": {
    "id": "program_doc_id",
    "name": "12 Week Strength",
    "description": "Optional text",
    "durationDays": 84,
    "createdBy": "creator_user_id",
    "adminIds": ["creator_user_id"],
    "joinCode": "ABC123",
    "createdAt": "2026-02-21T00:00:00.000Z"
  }
}
```
- **Errors**: `400` `Program name is required`; `400` `durationDays must be a positive integer`; `500` `Failed to create program`
- **Note**: `description` is stored as `null` when empty. `joinCode` is generated server-side and uppercase.

### 2. Look Up Program By Join Code
- **GET** `/api/programs/by-code/:code`
- **Auth**: Required (any authenticated user)
- **Output** (200):
```json
{
  "success": true,
  "data": { "id": "program_doc_id", "name": "12 Week Strength", "description": null, "durationDays": 84 }
}
```
- **Errors**: `404` `Invalid join code`; `500` `Failed to look up code`
- **Note**: Preview only, does not join. The code is trimmed and matched case-insensitively (uppercased).

### 3. Join Program
- **POST** `/api/programs/join`
- **Auth**: Required (any authenticated user)
- **Input**:
```json
{
  "code": "ABC123",
  "startDate": "2026-03-01T00:00:00.000Z"
}
```
- **Required**: `code` (non-empty string). `startDate` is optional (anything `new Date()` accepts); when missing or falsy it defaults to the current time.
- **Output** (200):
```json
{
  "success": true,
  "message": "Joined program \"12 Week Strength\" successfully",
  "data": { "programId": "program_doc_id", "programName": "12 Week Strength", "startDate": "2026-03-01T00:00:00.000Z" }
}
```
- **Errors**: `400` `code is required`; `404` `Invalid join code`; `400` `You have already joined this program`; `400` `Invalid startDate`; `500` `Failed to join program`
- **Notes**:
  - Any valid date is accepted, including dates in the past or far in the future. There is no range check.
  - Writes the member doc (`userId`, `startDate`, `joinedAt`) and `programMemberships.{programId}` (`name`, `startDate`, `durationDays`) on the user doc. These two writes are not atomic.
  - The "already joined" check is a read before the write, not a transaction.
  - A program admin can join their own program as a member.

### 4. Resolve Join Code (unified)
- **POST** `/api/join/resolve`
- **Auth**: Required (any authenticated user)
- **Input**: `{ "code": "ABC123" }`
- **Required**: `code` (non-empty string, trimmed)
- **Behavior**: Group codes are checked first. If the code matches a group, the caller **joins that group immediately**. If not, Program codes are checked and the program is only previewed (the client then calls `POST /api/programs/join` with a start date).
- **Output** (200, group matched and joined):
```json
{
  "success": true,
  "message": "Joined group \"CrossFit Warriors\" successfully",
  "data": { "type": "group", "groupId": "group_doc_id", "groupName": "CrossFit Warriors" }
}
```
- **Output** (200, program matched):
```json
{
  "success": true,
  "data": { "type": "program", "id": "program_doc_id", "name": "12 Week Strength", "description": null, "durationDays": 84 }
}
```
- **Errors**: `400` `code is required`; group join failure returns the group join status and message (`{ success: false, message }`); `404` `Invalid or expired code`; `500` `Failed to resolve code`

### 5. Get My Programs (Admin)
- **GET** `/api/programs/my-programs`
- **Auth**: Required. Returns programs where the caller is in `adminIds`.
- **Output** (200): newest first (`createdAt` desc)
```json
{
  "success": true,
  "data": [
    {
      "id": "program_doc_id",
      "name": "12 Week Strength",
      "description": null,
      "durationDays": 84,
      "createdBy": "creator_user_id",
      "adminIds": ["creator_user_id"],
      "joinCode": "ABC123",
      "createdAt": "2026-02-21T00:00:00.000Z",
      "memberCount": 12
    }
  ]
}
```
- **Errors**: `500` `Failed to fetch programs`
- **Note**: Here `joinCode` is always included because the caller is an admin of every returned program.

### 6. Get Member Programs (Athlete)
- **GET** `/api/programs/member-programs`
- **Auth**: Required. Returns programs the caller joined, read from `users.programMemberships`. Programs that no longer exist are omitted.
- **Output** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "program_doc_id",
      "name": "12 Week Strength",
      "description": null,
      "durationDays": 84,
      "startDate": "2026-03-01T00:00:00.000Z",
      "currentDayNumber": 5,
      "isComplete": false
    }
  ]
}
```
- **Errors**: `500` `Failed to fetch programs`
- **Notes**:
  - `currentDayNumber` is calendar-derived: days since `startDate` (in the user's timezone) + 1. It is `<= 0` before the start date and keeps growing past `durationDays` after the program ends.
  - `isComplete` is `currentDayNumber > durationDays`.
  - `name` and `durationDays` come from the program doc; `startDate` comes from the user-doc copy.

### 7. Get Weekly Activity (Coach-wide)
- **GET** `/api/programs/activity/this-week`
- **Auth**: Required. Covers all programs where the caller is an admin.
- **Query**: `since` (optional, anything `new Date()` accepts). Default: 7 days before now. Results with `submittedAt >= since` are returned. An unparsable `since` is not validated.
- **Output** (200): empty array when the caller administers no programs
```json
{
  "success": true,
  "data": [ { "programId": "program_doc_id", "submittedAt": "2026-02-21T10:00:00.000Z" } ]
}
```
- **Errors**: `500` `Failed to fetch weekly activity`
- **Note**: One entry per submitted result across all of the caller's programs. Order is not defined. Only workouts with a non-empty `submittedBy` are scanned.

### 8. Get Program By ID
- **GET** `/api/programs/:id`
- **Auth**: Required (any authenticated user; membership is not checked)
- **Output** (200):
```json
{
  "success": true,
  "data": {
    "id": "program_doc_id",
    "name": "12 Week Strength",
    "description": null,
    "durationDays": 84,
    "createdBy": "creator_user_id",
    "adminIds": ["creator_user_id"],
    "createdAt": "2026-02-21T00:00:00.000Z",
    "isAdmin": true,
    "joinCode": "ABC123"
  }
}
```
- **Errors**: `404` `Program not found`; `500` `Failed to fetch program`
- **Note**: `joinCode` is only present when the caller is an admin. `adminIds` is returned to every caller.

### 9. Update Program
- **PUT** `/api/programs/:id`
- **Auth**: Admin (middleware)
- **Input** (all optional):
```json
{ "name": "New name", "description": "New text", "durationDays": 90 }
```
- **Rules**: `name` is applied only when truthy (an empty string is ignored). `description` is applied when present; an empty value sets it to `null`. `durationDays` is parsed with `parseInt` and must be a finite number >= 1.
- **Output** (200): `{ "success": true, "message": "Program updated successfully" }`
- **Errors**: `400` `durationDays must be a positive integer`; `500` `Failed to update program`
- **Notes**: Changing `durationDays` does not update the `durationDays` copy in members' `programMemberships` (see Known behaviors). Sending no updatable fields results in an empty Firestore update, which is likely to return `500` (not verified).

### 10. Delete Program
- **DELETE** `/api/programs/:id`
- **Auth**: Admin (middleware)
- **Output** (200): `{ "success": true, "message": "Program deleted successfully" }`
- **Errors**: `500` `Failed to delete program`
- **Note**: Deletes the program doc and removes `programMemberships.{id}` from every member's user doc. The `members` and `workouts` subcollections are not deleted (orphaned).

### 11. Regenerate Join Code
- **POST** `/api/programs/:id/generate-code`
- **Auth**: Admin (middleware)
- **Output** (200): `{ "success": true, "data": { "joinCode": "XYZ789" } }`
- **Errors**: `500` `Failed to generate join code`
- **Note**: The old code stops working immediately.

### 12. Add Co-Admin
- **POST** `/api/programs/:id/admins`
- **Auth**: Admin (middleware)
- **Input**: `{ "email": "coach@example.com" }`
- **Required**: `email` (non-empty string, trimmed)
- **Output** (200):
```json
{
  "success": true,
  "message": "Admin added successfully",
  "data": { "userId": "coach_user_id", "name": "Coach Name", "email": "coach@example.com" }
}
```
- **Errors**: `400` `email is required`; `404` `No account found with that email`; `400` `That account is not a coach` (user's `userType` must be `coach`); `400` `This coach is already an admin`; `500` `Failed to add admin`

### 13. Remove Co-Admin
- **DELETE** `/api/programs/:id/admins/:userId`
- **Auth**: Admin (middleware)
- **Output** (200): `{ "success": true, "message": "Admin removed successfully" }`
- **Errors**: `400` `The program creator cannot be removed as admin`; `500` `Failed to remove admin`
- **Note**: Succeeds (200) even if `:userId` is not currently an admin. An admin can remove themselves unless they are the creator.

### 14. List Program Members (Roster)
- **GET** `/api/programs/:id/members`
- **Auth**: Admin (middleware)
- **Query**: `limit` (default 20, clamped to 1-50; non-numeric falls back to 20), `cursor` (a `userId` returned as `nextCursor`; an unknown cursor is ignored and the first page is returned)
- **Output** (200): ordered by `joinedAt` desc
```json
{
  "success": true,
  "data": [
    {
      "userId": "member_user_id",
      "name": "Athlete Name",
      "profilePictureUrl": null,
      "startDate": "2026-03-01T00:00:00.000Z",
      "joinedAt": "2026-02-25T00:00:00.000Z",
      "currentDayNumber": 5,
      "isComplete": false
    }
  ],
  "nextCursor": "last_member_user_id"
}
```
- **Errors**: `500` `Failed to fetch program members`
- **Notes**: `nextCursor` is `null` when the page has fewer than `limit` rows (when the last page is exactly `limit` long, one more request returns an empty page). `name` falls back to `nickname`, then `null`. `currentDayNumber` and `isComplete` are calendar-derived as in Get Member Programs, using each member's own timezone.

### 15. Get Member Stats
- **GET** `/api/programs/:id/members/:userId`
- **Auth**: Required. Caller must be a program admin, or be the same user as `:userId`.
- **Output** (200):
```json
{
  "success": true,
  "data": {
    "member": { "uid": "member_user_id", "name": "Athlete Name", "nickname": "Ath", "profilePictureUrl": null },
    "personalStats": { "currentStreak": 3, "longestStreak": 10 },
    "programStats": { "totalWorkouts": 5, "completedWorkouts": 4, "completionRate": 80.0 },
    "startDate": "2026-03-01T00:00:00.000Z",
    "currentDayNumber": 5,
    "recentSubmissions": [
      {
        "workoutId": "workout_doc_id",
        "workoutTitle": "Day 4",
        "dayNumber": 4,
        "submittedAt": "2026-03-04T10:00:00.000Z",
        "results": [ { "wodIndex": 0, "exerciseIndex": 0, "exerciseName": "Back Squat", "reps": 5, "weight": 100 } ]
      }
    ]
  }
}
```
- **Errors**: `404` `Program not found`; `403` `Not authorized to view this member`; `404` `User is not enrolled in this program`; `404` `User not found`; `500` `Failed to fetch member stats`
- **Notes**:
  - `totalWorkouts` = number of program workouts with `dayNumber <= currentDayNumber` (days visible so far). `completedWorkouts` = workouts whose `submittedBy` contains the user. `completionRate` = `completedWorkouts / totalWorkouts * 100`, one decimal, `0` when `totalWorkouts` is 0. `completedWorkouts` can exceed `totalWorkouts` (days submitted ahead of schedule), so the rate can exceed 100.
  - `recentSubmissions` = up to 5 submitted workouts, highest `dayNumber` first. `results` items are the stored result entries plus `exerciseName`; `submittedAt` is `null` if the result doc is missing.
  - If `:userId` is a program admin, the enrollment check is skipped: `startDate` and `currentDayNumber` are `null` and `totalWorkouts` counts all workouts in the program.
  - `personalStats` are the user's global streaks, not program-specific.

### 16. Remove Member (Leave or Remove)
- **DELETE** `/api/programs/:id/members/:userId`
- **Auth**: Required. Allowed when the caller is `:userId` (leaving) or a program admin (removing).
- **Output** (200): `{ "success": true, "message": "Member removed successfully" }`
- **Errors**: `404` `Program not found`; `403` `Not authorized to remove this member`; `500` `Failed to remove member`
- **Notes**: Deletes the member doc and `programMemberships.{id}` on the user doc. Does not check that `:userId` was a member (returns 200 either way; the user-doc update returns `500` if the user doc does not exist). Previously submitted results and `submittedBy` entries are kept, so the athlete's submitted days still show as submitted if they rejoin.

### 17. Create Program Workout
- **POST** `/api/programs/:id/workouts`
- **Auth**: Admin (middleware)
- **Input**:
```json
{
  "dayNumber": 1,
  "title": "Day 1",
  "notes": "Optional",
  "wodType": "structured",
  "wods": [
    {
      "name": "Strength",
      "exercises": [
        { "exerciseId": "exercise_doc_id", "name": "Back Squat", "instructions": "5x5", "trackingType": "weight_reps" }
      ]
    }
  ],
  "referenceLinks": []
}
```
- **Required**: `dayNumber` (`parseInt`, finite, >= 1), `wods` (non-empty array)
- **Validation**:
  - `wodType` is `"raw"` only when exactly `"raw"`; any other value (or missing) is treated as `"structured"`.
  - Every WOD needs a `name`.
  - Structured WODs: `exercises` must be a non-empty array; each exercise needs `exerciseId`, `name`, `instructions` (empty string allowed, `null`/missing not), `trackingType`; each `exerciseId` must exist in the exercise library.
  - Raw WODs: each needs a non-empty string `rawText`.
  - `referenceLinks` is stored only when an array, otherwise `[]`. Its items are not validated.
- **Output** (201):
```json
{
  "success": true,
  "message": "Program workout created successfully",
  "data": { "id": "workout_doc_id", "programId": "program_doc_id", "dayNumber": 1, "title": "Day 1", "createdBy": "admin_user_id", "wodType": "structured", "wods": [], "notes": null, "createdAt": "2026-02-21T00:00:00.000Z", "referenceLinks": [] }
}
```
- **Errors** (all `400` unless noted): `dayNumber must be a positive integer`; `wods array is required and cannot be empty`; `Each WOD must have a name`; `Each raw WOD must have a rawText`; `Each WOD must have at least one exercise`; `Each exercise must have exerciseId, name, instructions, and trackingType`; `Exercise with ID <id> not found in library`; `500` `Failed to create program workout`
- **Note**: `dayNumber` is not checked against `durationDays`, and a second workout for the same `dayNumber` is allowed (no uniqueness check).

### 18. List Program Workouts
- **GET** `/api/programs/:id/workouts`
- **Auth**: Required. Caller must be a program admin or a member.
- **Query**: `minDay`, `maxDay` (optional integers, inclusive range on `dayNumber`)
- **Output** (200): ordered by `dayNumber` asc
```json
{
  "success": true,
  "count": 1,
  "data": [
    { "id": "workout_doc_id", "programId": "program_doc_id", "dayNumber": 1, "title": "Day 1", "createdBy": "admin_user_id", "wodType": "structured", "wods": [], "notes": null, "createdAt": "2026-02-21T00:00:00.000Z", "referenceLinks": [], "hasSubmitted": false }
  ],
  "currentDayNumber": 5
}
```
- **Errors**: `404` `Program not found`; `403` `You have not joined this program`; `500` `Failed to fetch program workouts`
- **Notes**:
  - `submittedBy` is removed from each item; `hasSubmitted` is whether the caller's uid is in it.
  - Admins are treated as non-members: if the caller is an admin, no member lookup happens and `currentDayNumber` is omitted from the response (even if they also joined as an athlete). `currentDayNumber` is only returned for non-admin members (calendar-derived, same as Get Member Programs).
  - Members get the whole syllabus; future days are not hidden.
  - Non-numeric `minDay`/`maxDay` are not validated (parsed to `NaN`, likely `500`).

### 19. Get Program Workout By ID
- **GET** `/api/programs/:id/workouts/:workoutId`
- **Auth**: Required. Caller must be a program admin or a member.
- **Output** (200):
```json
{
  "success": true,
  "data": {
    "id": "workout_doc_id", "programId": "program_doc_id", "dayNumber": 1, "title": "Day 1", "createdBy": "admin_user_id",
    "wodType": "structured", "wods": [], "notes": null, "createdAt": "2026-02-21T00:00:00.000Z", "referenceLinks": [],
    "hasSubmitted": true,
    "userResult": { "userId": "user_id", "userName": "Athlete Name", "userProfilePictureUrl": null, "submittedAt": "2026-03-01T10:00:00.000Z", "results": [], "comment": null, "prDetails": [] }
  }
}
```
- **Errors**: `404` `Program not found`; `403` `You have not joined this program`; `404` `Workout not found`; `500` `Failed to fetch program workout`
- **Notes**: `hasSubmitted` is whether the caller has a result doc (not `submittedBy`, unlike the list route). `userResult` is `null` when none. A member can fetch any day, including future days.

### 20. Update Program Workout
- **PUT** `/api/programs/:id/workouts/:workoutId`
- **Auth**: Admin (middleware)
- **Input** (all optional): `title`, `notes`, `wodType`, `wods`, `referenceLinks`, `dayNumber`
- **Rules**: Fields are applied when present (not `undefined`). `title`/`notes` falsy values are stored as `null`. `wodType` is `"raw"` only when exactly `"raw"`, otherwise `"structured"`. `dayNumber` is `parseInt`ed, finite, >= 1. `wods` and `referenceLinks` are stored as sent, with **none** of the create-time validation.
- **Output** (200): `{ "success": true, "message": "Program workout updated successfully" }`
- **Errors**: `400` `dayNumber must be a positive integer`; `500` `Failed to update program workout` (also returned when `:workoutId` does not exist, since a Firestore update on a missing doc fails)
- **Note**: No uniqueness or `durationDays` check on `dayNumber`.

### 21. Delete Program Workout
- **DELETE** `/api/programs/:id/workouts/:workoutId`
- **Auth**: Admin (middleware)
- **Output** (200): `{ "success": true, "message": "Program workout deleted successfully" }`
- **Errors**: `500` `Failed to delete program workout`
- **Note**: Returns 200 even if the workout does not exist. The workout's `results` subcollection is not deleted.

### 22. Submit Program Workout Results
- **POST** `/api/programs/:id/workouts/:workoutId/submit`
- **Auth**: Required. Caller must be a member (admins who did not join get `403`).
- **Input**:
```json
{
  "results": [
    { "wodIndex": 0, "exerciseIndex": 0, "reps": 5, "weight": 100 }
  ],
  "comment": "Felt good"
}
```
- **Required**: `results` (array; an empty array is accepted). Items are not validated. `comment` optional (`null` when absent).
- **Output** (200):
```json
{
  "success": true,
  "message": "Results submitted successfully",
  "stats": { /* updated streak stats from StreakService.handleCompletionByDate */ }
}
```
- **Errors**: `400` `results array is required`; `404` `Program not found`; `403` `You have not joined this program`; `404` `Workout not found`; `500` `Failed to submit results`
- **Behavior**: Checks and creates personal records (`prDetails` stored on the result), updates the streak using the actual submission time, writes the result to `workouts/{workoutId}/results/{userId}`, adds the user to the workout's `submittedBy`, and increments `statsSummary.completedWorkouts` by 1.
- **Notes**:
  - The server does not check which day the workout is for: a member can submit any day (past, current, future), including before `startDate`.
  - Submitting again overwrites the stored result (`set`) but still increments `completedWorkouts` and runs PR/streak logic again. There is no "already submitted" error.
  - The steps are not transactional; a failure midway can leave PRs/streak updated without a stored result.

### 23. Get Program Workout Results (Leaderboard)
- **GET** `/api/programs/:id/workouts/:workoutId/leaderboard`
- **Auth**: Required. Caller must be a program admin (members, including the submitter, get `403`).
- **Query**: `limit` (default 20, max 50; no lower bound check), `startAfter` (ISO date, the previous `nextCursor`)
- **Output** (200): newest submission first (`submittedAt` desc)
```json
{
  "success": true,
  "data": {
    "workoutId": "workout_doc_id",
    "workoutTitle": "Day 1",
    "dayNumber": 1,
    "nextCursor": "2026-03-01T10:00:00.000Z",
    "results": [
      {
        "userId": "member_user_id",
        "userName": "Athlete Name",
        "profilePicture": null,
        "submittedAt": "2026-03-01T10:00:00.000Z",
        "comment": null,
        "exercises": [
          {
            "wodIndex": 0, "wodName": "Strength", "exerciseIndex": 0, "exerciseName": "Back Squat", "trackingType": "weight_reps",
            "reps": 5, "weight": 100, "timeInSeconds": null, "distanceMeters": null, "calories": null,
            "isPR": false, "previousBest": null
          }
        ]
      }
    ]
  }
}
```
- **Errors**: `404` `Program not found`; `403` `Only a program admin can view results`; `404` `Workout not found`; `500` `Failed to fetch results`
- **Notes**: Despite the name this is a chronological results feed, not a ranking. `nextCursor` is `null` when the page has fewer than `limit` rows. Exercise names/types come from the workout's current `wods`, falling back to the stored result values, then `Unknown`/`reps`.

### Known behaviors (program endpoints)
- The current day is calendar-derived from `startDate`; it does not depend on completion. Submitting a workout does not move the athlete's day.
- `programMemberships.{id}` on the user doc holds a copy of `name`, `startDate`, `durationDays` taken at join time. Renaming the program or changing `durationDays` does not update it; `member-programs` re-reads `name`/`durationDays` from the program doc, but other readers of the denormalized copy (e.g. the home/week feed) use the stored copy.
- Dates are returned as ISO 8601 strings in JSON.

---

## 📱 APP VERSION ENDPOINT (`/api/app`)

### 1. Get Minimum App Version
- **GET** `/api/app/version`
- **Auth**: None (public)
- **Output** (200):
```json
{
  "minimumVersion": "1.0.0"
}
```
- **Notes**: Defined in `app.ts`. The response has no `success` field. The value comes from the `MIN_APP_VERSION` env var (format `x.y.z`, default `1.0.0` when unset, empty or not in that format). The mobile app calls this at launch to decide whether to require an update.

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
