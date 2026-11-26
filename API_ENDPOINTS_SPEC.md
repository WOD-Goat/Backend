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

Programs are coach-authored, day-numbered plans (`dayNumber` 1..`durationDays`). Athletes join with a join code and a chosen `startDate`. Member progress (current day, completed and missed days) is stored and drives Submit and Skip To Day; the read endpoints and the week feed still compute the current day from `startDate` (calendar-based, in the user's `timezone`, default `Africa/Cairo`).

> **Planned: not implemented yet.** Items tagged `(planned)` describe the completion-based progress model from `docs/plans/program-progress.md`. Until the code lands, the behavior described without a `(planned)` tag is what the server does today. Where both appear, the `(planned)` text is the future behavior. See "Program progress model" at the end of this section.
>
> **Already implemented** (untagged): one workout per `dayNumber`, `dayNumber <= durationDays`, the coach edit restrictions after a first join (`DAY_LOCKED`, `DURATION_LOCKED`), archiving a member on leave or removal, the transactional Join Program with stored progress and archive restore, completion-based Submit Program Workout Results, Skip To Day and Update Start Date. The read endpoints and the week feed still derive the day from the calendar.

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
- **Required**: `code` (non-empty string). `startDate` is optional: a string or number, converted as described under Start date values (Program progress model). When missing or falsy it defaults to the current time.
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
  - Any usable date is accepted, including dates in the past or far in the future (see Start date values for the limits). The start date only blocks starting early (see Update Start Date and Program progress model). With a past date, rest days do not resolve backwards; counting starts from the join date.
  - Check order: `code`, then the program (`404`), then membership (`You have already joined this program`), then `startDate`. A refused join writes nothing. A missing user account is `500` `Failed to join program` and writes nothing.
  - The join is one transaction. It looks the program up by code, creates the member doc (`userId`, `startDate`, `joinedAt` and the progress fields, see Program progress model) with a create that fails if the doc exists, writes `programMemberships.{programId}` (`name`, `startDate`, `durationDays` and the copied progress fields) on the user doc and sets the program's internal, permanent "has had members" flag. Of two concurrent joins by one user, one succeeds and the other gets `400` `You have already joined this program`. The flag locks coach edits (see Update Program, Update and Delete Program Workout) and is never returned by any route.
  - **First join** (no archive): progress is seeded from the program workouts the user already submitted (`submittedBy`, dated by each result's `submittedAt` in the athlete's timezone). Those days are completed, empty days below the highest submitted day are completed rest days, the current day is the first day not completed, and it is locked until tomorrow if one of them was submitted today. A user with no submissions starts on day 1, whatever the start date.
  - **Rejoin**: if an archive exists at `programs/{id}/formerMembers/{userId}`, the progress is restored exactly as archived (current day, `currentSince`, lock, completed, missed and rest days, `completedOn`, completed workout ids, skips, `completedAt`), the archive is deleted and the program id is removed from `formerProgramIds` on the user doc. `joinedAt` is the time of this join.
    - The member **had not started** when the athlete's local date at rejoin is earlier than the archived `startLocalDate`. Only then the `startDate` of this request (default: now) replaces the archived one: any date is accepted as on a first join, and `currentSince` becomes the later of the new start date and today.
    - Otherwise the original `startDate` and `startLocalDate` are kept and the sent `startDate` is ignored (it must still be usable), and `data.startDate` in the response is the kept one.
    - Rest days that went by during the absence count as passed: they resolve like any other rest day (consecutive ones, up to the first workout day).
    - Leaving therefore cannot erase missed days or bypass the lock.
    - A result added after the archive was written is covered by Self-heal, like for any member.
    - An archive without usable progress (`resolved: false`, or stored data that cannot be read) is logged, deleted and treated like no archive: progress is seeded from the submissions with the requested start date.
  - A program admin can join their own program as a member.
  - Differences from earlier behavior: the member doc and user-doc copy were written separately after a read; no progress was stored (the first submit seeded it by the calendar rule, so a past start date began on the calendar day); a rejoin took the new start date; and any value `new Date()` accepts (such as a boolean or an array) was taken as a start date.

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
- **Note**: This route never joins a program (it only previews), so the transactional join and seeding apply only to `POST /api/programs/join`. No other route creates program member docs.

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
  - **(planned)** `currentDayNumber` and `isComplete` keep their names; their meaning becomes the stored progress (the member's `currentDay`), not the calendar. After the last day is done, `currentDayNumber = durationDays + 1` and `isComplete = true`; it is never higher. New fields per item **(planned)**:
```json
{
  "isRestDay": false,
  "completedDays": [1, 2, 3],
  "missedDays": [4],
  "nextUnlockAt": "2026-03-05T22:00:00.000Z",
  "progressPct": 3.6,
  "followThroughPct": 75.0,
  "missedCount": 1
}
```
  - **(planned)** `nextUnlockAt` is the UTC instant of the athlete's next local midnight while the current day is locked, otherwise `null`. Before `startDate` (athlete local date), `currentDayNumber` is `1` and `nextUnlockAt` is the UTC instant of the local midnight that starts the start date. `progressPct` = completed days (including rest days) / `durationDays` * 100. `followThroughPct` = completed workout days / (completed + missed workout days) * 100, and is `null` when completed + missed workout days is 0 (clients show "-"). Both percentages have one decimal. `missedCount` = number of `missedDays`. `isRestDay` is `true` when the program has started, is not complete and the current day is a rest day for this member (see Program progress model), otherwise `false` (an unlocked current rest day has `nextUnlockAt: null` although nothing can be submitted).

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
- **Errors**: `400` `durationDays must be a positive integer`; `409` `DURATION_LOCKED`; `500` `Failed to update program`
- **Shortening after a join**: Once anyone has joined, `durationDays` cannot be made smaller: `409` `{ "success": false, "message": "The program cannot be shortened after athletes have joined", "code": "DURATION_LOCKED" }`, and nothing is updated (including `name` and `description` sent in the same request). The same or a larger value is allowed; before the first join any valid value is allowed. "Anyone has joined" stays true after every member has left (see Program edit locks). The check and the write run in one transaction.
- Before the first join, shortening does not touch workouts whose `dayNumber` ends up above the new `durationDays`; they can still have their content edited.
- **Notes**: Changing `durationDays` does not update the `durationDays` copy in members' `programMemberships` (see Known behaviors). Sending no updatable fields results in an empty Firestore update, which is likely to return `500` (not verified).

### 10. Delete Program
- **DELETE** `/api/programs/:id`
- **Auth**: Admin (middleware)
- **Output** (200): `{ "success": true, "message": "Program deleted successfully" }`
- **Errors**: `500` `Failed to delete program`
- **Note**: Deletes the program doc and the `formerMembers` archives, and removes `programMemberships.{id}` from every member's user doc. The `members` and `workouts` subcollections are not deleted (orphaned).

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
- **(planned)** Each roster item keeps `currentDayNumber` and `isComplete` (now the stored progress, with the same end-of-program rule as Get Member Programs: `durationDays + 1` and `true`, never higher) and adds `isRestDay`, `completedDays`, `missedDays`, `nextUnlockAt`, `progressPct`, `followThroughPct`, `missedCount` (definitions, one-decimal rounding and the `null` `followThroughPct` rule under Get Member Programs). The roster does not include the `skips` log; only member stats include it.

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
  - **(planned)** `currentDayNumber` is the stored progress (same rule as Get Member Programs). New fields on `data`: `isComplete`, `isRestDay`, `completedDays`, `missedDays`, `nextUnlockAt`, `progressPct`, `followThroughPct`, `missedCount`, and the `skips` log:
```json
{ "skips": [ { "fromDay": 4, "toDay": 7, "at": "2026-03-04T10:00:00.000Z", "reason": "Travel" } ] }
```
  `reason` is omitted when not given. Existing `programStats` field names stay; their definitions change **(planned)**: `totalWorkouts` = completed + missed workout days, `completedWorkouts` = completed workout days, `completionRate` = `followThroughPct` (one decimal; `null` when completed + missed workout days is 0, clients show "-"). The rate then cannot exceed 100.

### 16. Remove Member (Leave or Remove)
- **DELETE** `/api/programs/:id/members/:userId`
- **Auth**: Required. Allowed when the caller is `:userId` (leaving) or a program admin (removing).
- **Output** (200): `{ "success": true, "message": "Member removed successfully" }`
- **Errors**: `404` `Program not found`; `403` `Not authorized to remove this member`; `500` `Failed to remove member`
- **Notes**: Does not check that `:userId` was a member (returns 200 either way; `500` if the user doc does not exist). Previously submitted results and `submittedBy` entries are kept, so the athlete's submitted days still show as submitted if they rejoin. A leave or removal racing a join is applied before or after it, never mixed.
- **Archive**: For a member, one transaction writes `programs/{id}/formerMembers/{userId}`, deletes the member doc and `programMemberships.{id}`, adds the program id to `formerProgramIds` on the user doc and sets the program's "has had members" flag. The roster and member counts are unaffected. For a non-member only a leftover `programMemberships.{id}` entry is removed; no archive is written or replaced.
  - Archive document: `{ userId, archivedAt, resolved, member }`. `member` is the member doc as it was (`userId`, `startDate`, `joinedAt`, ...) with the progress resolved at the time of leaving (the stored fields listed under Program progress model). A member who joined before progress was stored is seeded first (calendar rule).
  - If progress cannot be resolved (for example an invalid `startDate`), `resolved` is `false`, `member` is the stored doc unchanged, and the leave still succeeds.
  - If the member's account no longer exists, the member doc is deleted without an archive and the response is `500` `Failed to remove member`.
- **Account deletion** (`DELETE /api/users/profile`, and the admin user deletion) deletes the user's archives listed in `formerProgramIds`, together with the user doc. It does not remove current program memberships (`programs/{id}/members/{uid}` docs stay).
- Rejoining restores the archive and deletes it (see Join Program).

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
- **Errors** (all `400` unless noted): `dayNumber must be a positive integer`; `wods array is required and cannot be empty`; `Each WOD must have a name`; `Each raw WOD must have a rawText`; `Each WOD must have at least one exercise`; `Each exercise must have exerciseId, name, instructions, and trackingType`; `Exercise with ID <id> not found in library`; `DAY_OUT_OF_RANGE`; `409` `DAY_ALREADY_HAS_WORKOUT`; `500` `Failed to create program workout`
- **Day rules** (checked in the same transaction as the write; nothing is created when one fails):
  - `dayNumber` must be `<= durationDays`: `400` `{ "success": false, "message": "dayNumber cannot be greater than durationDays", "code": "DAY_OUT_OF_RANGE" }`
  - Only one workout per `dayNumber`: `409` `{ "success": false, "message": "A workout already exists for this day", "code": "DAY_ALREADY_HAS_WORKOUT" }`
- **Note**: Adding a workout to an empty day stays allowed after athletes have joined. The program doc's cached `workoutDays` (each day with the time its workout was added) is updated on create. Duplicate or out-of-range days created before these rules existed are left as they are.

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
  - **(planned)** For non-admin members the response keeps `currentDayNumber` (stored progress, same rule as Get Member Programs) and adds `isComplete`, `isRestDay`, `completedDays`, `missedDays`, `nextUnlockAt`, `progressPct`, `followThroughPct`, `missedCount` at the top level next to it. The whole syllabus is still returned; only the current day can be submitted.

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
- **Errors**: `400` `dayNumber must be a positive integer`; `400` `DAY_OUT_OF_RANGE`; `409` `DAY_LOCKED`; `409` `DAY_ALREADY_HAS_WORKOUT`; `500` `Failed to update program workout` (also returned when `:workoutId` does not exist, since a Firestore update on a missing doc fails)
- **Day rules**: These apply only when `dayNumber` is sent and differs from the stored one. They are checked in this order, in the same transaction as the write; when one fails nothing is updated, including other fields in the request. Bodies are `{ "success": false, "message": "<text>", "code": "<CODE>" }`.
  1. `dayNumber <= durationDays`: `400` `DAY_OUT_OF_RANGE`, `dayNumber cannot be greater than durationDays`.
  2. Nobody has ever joined the program: otherwise `409` `DAY_LOCKED`, `Workout days cannot be moved or deleted after athletes have joined` (also for a move to an empty day).
  3. No other workout uses the new day: otherwise `409` `DAY_ALREADY_HAS_WORKOUT`, `A workout already exists for this day`.
- Editing the content, or sending the unchanged `dayNumber`, is always allowed, including for duplicate or out-of-range days created before these rules existed.
- **Note**: Coach edits never rewrite member progress. The cached `workoutDays` is updated; editing content does not change the time a day's workout was added.

### 21. Delete Program Workout
- **DELETE** `/api/programs/:id/workouts/:workoutId`
- **Auth**: Admin (middleware)
- **Output** (200): `{ "success": true, "message": "Program workout deleted successfully" }`
- **Errors**: `409` `DAY_LOCKED`; `500` `Failed to delete program workout`
- **Delete after a join**: Once anyone has joined the program, deleting an existing workout returns `409` `{ "success": false, "message": "Workout days cannot be moved or deleted after athletes have joined", "code": "DAY_LOCKED" }`. This includes duplicate or out-of-range days created before the day rules existed. Before the first join deleting is allowed, and the day is removed from the cached `workoutDays`. The check and the delete run in one transaction.
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
  "stats": { /* updated streak stats from StreakService.handleCompletionByDate, or null */ }
}
```
  `stats` is `null` when the streak did not change (a completion was already counted on this local date) or when the streak update failed.
- **Errors**: `400` `results array is required`; `404` `Program not found`; `403` `You have not joined this program`; `404` `Workout not found`; the `409` codes below; `500` `Failed to submit results`; `500` `Your progress in this program could not be loaded, so your results were not saved. Please contact your coach.` (the stored member data cannot be turned into progress; nothing is written)
- **Day rules**: Only the member's current day can be submitted, once. The server uses the stored progress (see Program progress model); a member who joined before progress was stored is seeded by the calendar rule, and the seeded progress is saved with the submission. Days that already have a result are completed first (see Self-heal under Program progress model), so the checks run against the healed progress. The first failing check is returned, in this order, as `409` `{ "success": false, "message": "<readable text>", "code": "<CODE>", ... }` (older app versions show `message`):
  1. `NOT_STARTED`. The athlete's local date is before the start date.
  2. `ALREADY_SUBMITTED`. The day was already completed by a submission (in `completedDays` and not in `restDays`), or a result doc already exists for this user and workout.
  3. `NOT_CURRENT_DAY`, extra field `currentDay`. Any other workout that is not the current day (missed days, auto-completed or skipped rest days, future days). `currentDay` is `durationDays + 1` once the program is finished.
  4. `LOCKED`, extra field `nextUnlockAt` (ISO, a local midnight). The current day was reached but a day was already completed on the same local calendar day.
  - After these, a workout the member already submitted that now sits on the current day is also `ALREADY_SUBMITTED`.
- **Behavior**: One transaction reads the program, member, user and result docs and applies the checks. It then creates the result doc (without `prDetails`), adds the user to the workout's `submittedBy`, saves the member progress and its user-doc copy (`completedDays`, `completedOn`, `completedWorkoutIds`, next `currentDay`, `lockedUntil`, `completedAt` after the last day, and any rest days resolved on the way) and increments `statsSummary.completedWorkouts` by 1. A rejected submit writes nothing, with one exception: for a member with stored progress, days completed by Self-heal are saved (member doc and user-doc copy) even though the request is rejected. Submitting the healed day returns `ALREADY_SUBMITTED`; submitting the new current day follows the normal checks, so it can succeed in the same request or return `LOCKED` (for example when the healed result is from today). The workout doc is read before the transaction (its day cannot change once the program has members).
- **After the commit**: Personal records are checked and created, then the streak is updated using the actual submission time, then `prDetails` is saved on the result doc. A failure in any of these steps is logged; the day stays completed and the response is still `200`. A result whose `prDetails` could not be saved has no `prDetails` field.
- **Notes**:
  - Differences from earlier behavior: any day could be submitted, including before the start date; resubmitting overwrote the result and counted `completedWorkouts` again; and the PR and streak steps ran before the result was stored.
  - The read endpoints and the week feed are still calendar-derived (planned change), so the day they show as current can differ from the day this route accepts, for example after an athlete lets a workout day pass without submitting it.

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

### 24. Skip To Day
- **POST** `/api/programs/:id/skip`
- **Auth**: Required. Caller must be a member (athlete only; admins who did not join get `403`). Forward only.
- **Input**:
```json
{ "toDay": 7, "reason": "Travel" }
```
- **Required**: `toDay` (a JSON number with an integer value; a numeric string is refused). `reason` optional string, trimmed, at most 200 characters after trimming (`400` if longer). A `null` or blank `reason` counts as not given.
- **Check order**: the body (types and `reason` length) is validated first, so an invalid body returns `400` even for an unknown program or a non-member. Then `404`, `403`, `409` `NOT_STARTED`, finished program, and the `toDay` range.
- **Rules**:
  - `toDay` must be an integer, `> currentDay` and `<= durationDays`. `currentDay` here is the stored progress after Self-heal and rest-day resolution; a member without stored progress is seeded by the calendar rule first (saved when the skip succeeds).
  - A finished program (`currentDay = durationDays + 1`) cannot be skipped: `400`.
  - Not allowed before the program's `startDate` (athlete local date): `409` `NOT_STARTED`.
  - Runs in one transaction.
  - Rest days the athlete has already passed by date are completed first (including days whose workout was added too late, see Program progress model).
  - Days in `[currentDay, toDay - 1]` that are not completed and are workout days (a workout exists for that `dayNumber`) become missed. Rest/gap days are never missed: those passed over are completed as rest days (added to `completedDays` and `restDays`, with no `completedOn`). Completed days stay completed.
  - A day in `[currentDay, toDay - 1]` that is not completed but already has a result from this athlete is completed instead of missed: `completedOn` is the local date of the result's `submittedAt` and the workout id is added to `completedWorkoutIds`. It does not change the lock or `currentSince`.
  - `currentDay` becomes `toDay`. If `toDay` is already completed, it becomes the next incomplete day after it. If none remain, the program is complete: `completedAt` is set and `currentDayNumber = durationDays + 1`.
  - If the day landed on already has a result, Self-heal applies to it within the same request (see Program progress model; at most 14 days): it is completed, `currentDay` moves on, and the lock follows the result's date without shortening an existing lock. The response shows the progress after this.
  - Skipping while the current day is locked keeps the existing `lockedUntil` (the target day is locked until then). Skipping while unlocked makes the target day available immediately.
  - The skip is appended to the member's `skips` log (`fromDay` = previous `currentDay`, `toDay` as sent, `at`, `reason` if given).
  - The member doc and the user-doc copy are written together. A skip writes no result doc, does not change `completedWorkouts` or a workout's `submittedBy`, and runs no PR or streak logic. A rejected skip writes nothing, with the same exception as submit: for a member with stored progress, days completed by Self-heal are saved.
  - Skips are one at a time: of two identical concurrent requests one succeeds and the other returns `400`. A submit racing a skip is applied before or after it, never mixed.
- **Output** (200): `message` is `Skipped to day <toDay as sent>` (even when the athlete lands on a later day); `data` is the updated progress block (`currentDayNumber`, `isComplete`, `isRestDay`, `completedDays`, `missedDays`, `nextUnlockAt`, `progressPct`, `followThroughPct`, `missedCount`; percentage rules as in Get Member Programs)
```json
{
  "success": true,
  "message": "Skipped to day 7",
  "data": {
    "currentDayNumber": 7,
    "isComplete": false,
    "isRestDay": false,
    "completedDays": [1, 2, 3],
    "missedDays": [4, 5],
    "nextUnlockAt": null,
    "progressPct": 3.6,
    "followThroughPct": 60.0,
    "missedCount": 2
  }
}
```
- **Errors**:
  - `400` `{ "success": false, "message": "<one of below>" }` (no `code`): `toDay must be an integer`; `reason must be a string`; `reason cannot be longer than 200 characters`; `Program is already complete`; `toDay must be greater than the current day`; `toDay cannot be greater than durationDays`
  - `403` `You have not joined this program`; `404` `Program not found`
  - `409` `NOT_STARTED` (body `{ success: false, message, code }`)
  - `500` `Failed to skip to day`; `500` `Your progress in this program could not be loaded, so no days were skipped. Please contact your coach.` (nothing is written)
- **Note**: Streaks are not affected (a skip submits nothing). Until the read endpoints and the week feed use stored progress (planned), they do not show the result of a skip.

### 25. Update Start Date
- **PATCH** `/api/programs/:id/start-date`
- **Auth**: Required. Caller must be a member (admins who did not join get `403`).
- **Input**:
```json
{ "startDate": "2026-03-10" }
```
- **Required**: `startDate`, a string or number converted as described under Start date values (Program progress model). Both `"2026-03-10"` and an ISO timestamp are accepted.
- **Check order**: `startDate` is validated first, so an unusable value returns `400` even for an unknown program or a non-member. Then `404`, `403`, `409` `START_DATE_LOCKED`.
- **Rules**: Allowed only while the member's current start date is still in the future (athlete local date), and the new date must be today or later (athlete local date). Otherwise `409` `START_DATE_LOCKED`. Sending the current date again is allowed. Choosing today starts the program immediately, so it cannot be changed again. It changes only when day 1 opens (`startDate`, `startLocalDate`, and `currentSince`, which follows the start date); it does not change any progress field (days, lock, skips). A member who joined before progress was stored is seeded by the calendar rule first, saved when the change succeeds.
- **Behavior**: One transaction updates the member doc and the user-doc copy (`startDate`, `startLocalDate` and the progress fields). A rejected change writes nothing, with the same exception as submit: for a member with stored progress, days completed by Self-heal are saved. A submit or skip racing a change is applied before or after it, never mixed.
- **Output** (200): the updated progress block (as in Skip To Day)
```json
{
  "success": true,
  "message": "Start date updated",
  "data": { "currentDayNumber": 1, "isComplete": false, "isRestDay": false, "completedDays": [], "missedDays": [], "nextUnlockAt": "2026-03-09T22:00:00.000Z", "progressPct": 0, "followThroughPct": null, "missedCount": 0 }
}
```
- **Errors**: `400` `Invalid startDate` (missing or unusable, no `code`); `403` `You have not joined this program`; `404` `Program not found`; `409` `{ "success": false, "message": "<readable text>", "code": "START_DATE_LOCKED" }` (start date already reached, or new date is in the past); `500` `Failed to update start date`; `500` `Your progress in this program could not be loaded, so your start date was not changed. Please contact your coach.` (nothing is written)
- **Note**: Until the read endpoints and the week feed use stored progress (planned), they derive the day from the changed `startDate`.

### Home/week feed (planned)
Not a program route. Only `GET /api/workouts/week?startDate=...&endDate=...` merges program days into the feed; it also returns the athlete's program workouts, each with a `scheduledFor` date. (`getWeekWorkoutsGrouped` is not routed and is not part of this contract.) The response shape is unchanged; only how `scheduledFor` is produced changes **(planned)**:
- It is generated from stored progress in the athlete's timezone, not from `startDate` + `dayNumber`.
- A completed day: its completion date (`completedOn`). For an auto-completed rest day this is that rest day's own local date (the date it was the current day), not the midnight at which it resolved.
- The current day: the latest of today, `lockedUntil` and `startDate` (local dates).
- Each later day: one local calendar day after the previous one.
- Missed days are omitted. Rest days never appear: every day in `restDays` is left out of the feed, even if it has a `completedOn` or a workout is added to it later.
- Which program days appear in a requested date range follows from these generated dates.

### Program progress model (partly implemented)
Join, Submit Program Workout Results, Skip To Day, Update Start Date and leaving use stored progress. The read endpoints and the week feed do not yet: they still derive the day number from the calendar (see the section intro and Known behaviors). Members who joined before progress was stored have none until it is first saved (a successful submit, skip or start-date change, or a leave), when it is seeded by the calendar rule. The full model:
- Progress is stored per member. The stored `currentDay` replaces the calendar-derived day number.
- The current day stays current until it is completed. Completing it moves the athlete to the next day.
- One advance per local calendar day. After completing a day on local date D, the next day unlocks at the athlete's next local midnight (D + 1). Timezone comes from the user profile (`users.timezone`, default `Africa/Cairo`). A timezone change can shift an unlock by about one day; this is accepted.
- A day with no workout is a rest day. It becomes current like any other day and auto-completes at the next local midnight. It counts toward `progressPct`, not `followThroughPct`, and is never "missed".
- Any empty day that passes counts as a rest day, even if nothing later in the program is written yet. Coaches must publish workouts before athletes reach a day; otherwise it auto-completes as rest and cannot be submitted.
- A workout added after the athlete passed a day does not reopen it, whether or not the progress had been saved. Each current day has its own local date (the latest of `currentSince`, `lockedUntil` and `startLocalDate`). It is a workout day only if its workout was added on that date or earlier (the workout's `createdAt` in the athlete's timezone; added any time on that date counts). Added later, the day completes as a rest day (`restDays`, never missed). Athletes who have not passed the day get it as a workout. Editing a workout's content does not change when it was added. Members who joined before this feature are seeded by whether a workout exists, regardless of when it was added.
- Only the current day can be submitted. Completed days are viewable. The whole program is visible.
- One submission per day.
- Skipping is forward-only and athlete-only. Uncompleted workout days that are skipped over become "missed". Missed days do not block finishing.
- When the last day is done, `completedAt` is set and `currentDayNumber = durationDays + 1`, `isComplete = true`.
- Coach edits never rewrite member progress. Once anyone has joined, workouts cannot be moved or deleted and `durationDays` cannot be shortened (implemented, see Program edit locks); editing content, adding a workout to an empty day and lengthening stay allowed. As a defensive rule, a member whose `currentDay` is beyond `durationDays` is treated as complete (computed on read, not written). If `durationDays` grows after a member completed, the member stays completed.
- Leaving or being removed archives progress in `programs/{id}/formerMembers/{userId}` and account deletion deletes the archive (see Remove Member). Rejoining restores it as it was, so leaving cannot erase missed days or bypass the lock. A new start date applies only if the member had not started. Progress is seeded from existing submissions only when there is no usable archive (see Join Program).
- Members who joined before this feature (no `currentDay`) are seeded by the calendar rule, both on first use and by the migration: they are placed on their calendar day (or the next day not submitted); earlier unsubmitted workout days are missed (with one `migration` skip) and earlier rest days are completed.
- Before `startDate` (athlete local date): submit and skip both return `409` `NOT_STARTED`, `currentDayNumber` is `1`, and `nextUnlockAt` is the local midnight that starts the start date. Join accepts any `startDate`, including past dates; the start date only blocks starting early. It can be changed only while still in the future (`START_DATE_LOCKED` otherwise), and only changes when day 1 opens.
- Start date values (join and Update Start Date): a `startDate` of the form `YYYY-MM-DD` is that calendar date in the athlete's timezone and is stored as the local midnight that starts it. Any other string, or a number (milliseconds), is read by `new Date()`: it is stored as that moment, and `startLocalDate` is the date it has in the athlete's timezone (`users.timezone`, default `Africa/Cairo`; send an offset or `Z`, since a timestamp without one is read in the server's timezone). The mobile app sends the picked date at the current time of day as an ISO timestamp, which gives the picked date when the phone's timezone matches the athlete's stored one; otherwise it can differ by a day. Impossible calendar dates (`2026-02-30`), values of another type and years outside 1000-9998 are `400` `Invalid startDate`.
- Percentages (`progressPct`, `followThroughPct`) have one decimal. `followThroughPct` is `null` when completed + missed workout days is 0.
- `completedOn` for an auto-completed rest day is that rest day's own local date (the date it was the current day), not the midnight at which it resolved.
- Streaks are unchanged. Skipped and missed days submit nothing, so they neither add to nor break a streak.
- Self-heal (implemented for submit, skip, start-date and leave): a result doc can exist for a day the progress does not count as completed (a partial write by earlier versions). When progress is loaded and the current day, after rest-day resolution, is a started workout day with a result from this athlete, the day is completed: `completedOn` is the local date of the result's `submittedAt`, `currentSince` that date and `lockedUntil` the day after it, except that `currentSince` and `lockedUntil` never move earlier than the values already held (an old result does not shorten an existing lock or backdate the next day). The workout id is added to `completedWorkoutIds`; if it was the last day, `completedAt` is the result's `submittedAt`. This repeats while the next current day also has a result, at most 14 days per load (a later load continues). It does not change the result doc or `completedWorkouts` and does not run PR or streak logic. Other days are examined only when they become current, or when a skip passes over them (see Skip To Day). For a member without stored progress it applies on top of the calendar seeding and is saved only by a successful submit, skip or start-date change, or a leave. A join does not run it; it applies the next time the progress is loaded.

Stored member fields (`programs/{id}/members/{userId}`; a subset is copied to `users.programMemberships.{id}`):

| Field | Type | Notes |
|---|---|---|
| `currentDay` | number | 1-based |
| `currentSince` | string `YYYY-MM-DD` | athlete local date when the day became current |
| `lockedUntil` | string `YYYY-MM-DD` | local date; the current day is locked while local today is earlier |
| `completedDays` | number[] | includes auto-completed rest days |
| `restDays` | number[] | the subset of `completedDays` completed as rest days |
| `completedOn` | map `dayNumber` to `YYYY-MM-DD` | completion date, used by the feed; absent for skipped and seeded rest days |
| `completedWorkoutIds` | string[] | |
| `missedDays` | number[] | |
| `skips` | `{ fromDay, toDay, at, reason? }[]` | member doc only |
| `completedAt` | date | set when the program is finished |
| `startDate` | date | kept |
| `startLocalDate` | string `YYYY-MM-DD` | new |

The `completedDays` list is the source of truth for progress; `submittedBy` on the workout is the source for `hasSubmitted`. They can still differ (for example after edits made before this feature).

Error codes for program progress. All new 409/4xx bodies are `{ "success": false, "message": "<readable text>", "code": "<CODE>", ...extra }`. The codes for program edits (`DAY_OUT_OF_RANGE`, `DAY_ALREADY_HAS_WORKOUT`, `DAY_LOCKED`, `DURATION_LOCKED`) for submit, skip and start-date are implemented:

| Code | Route | Extra fields | Meaning |
|---|---|---|---|
| `NOT_CURRENT_DAY` | submit | `currentDay` | the workout is not the member's current day |
| `LOCKED` | submit | `nextUnlockAt` | a day was already completed on this local date |
| `ALREADY_SUBMITTED` | submit | none | the day was already submitted, or a result already exists |
| `NOT_STARTED` | submit, skip | none | the program has not started yet (athlete local date) |
| `START_DATE_LOCKED` | start-date | none | the start date has already passed, or the new date is in the past |
| `DAY_OUT_OF_RANGE` | create/update program workout | none | `dayNumber` is greater than `durationDays` (400) |
| `DAY_ALREADY_HAS_WORKOUT` | create/update program workout | none | another workout already uses this `dayNumber` (409) |
| `DAY_LOCKED` | update (move) / delete program workout | none | someone has joined the program, so workouts cannot be moved or deleted (409) |
| `DURATION_LOCKED` | update program | none | someone has joined the program, so `durationDays` cannot be shortened (409) |

Program edit locks: "someone has joined" means the program doc carries the permanent flag set by a join or a leave, or it has any doc in `members` or `formerMembers` (older programs; the flag is saved when such a doc is found by one of these checks). It is never unset. A member who left an older program before archives existed leaves no trace and does not count.

### Known behaviors (program endpoints)
- The current day shown by the read endpoints and the week feed is derived from `startDate`; it does not depend on completion, although Submit and Skip To Day use and move the stored day. For example a new member with a past start date is on day 1 for submit while the reads show the calendar day. (fixed by the planned progress model)
- `programMemberships.{id}` on the user doc holds a copy of `name`, `startDate`, `durationDays` taken at join time (`startDate` is also updated by Update Start Date). Renaming the program or changing `durationDays` does not update it; `member-programs` re-reads `name`/`durationDays` from the program doc, but other readers of the denormalized copy (e.g. the home/week feed) use the stored copy.
- Programs may still hold duplicate or out-of-range workout days created before the day rules; they are not cleaned up, and once someone has joined they cannot be moved or deleted.
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
