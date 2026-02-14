# 🎬 Soundtrack Mood Explorer — Backend
Backend API for the Soundtrack Mood Explorer application.

Responsible for:

- Authentication (JWT)
- Soundtrack data storage
- Favorites management
- Database seeding
- REST API endpoints
Built as part of a full-stack portfolio project.

## 🚀 Features
- 🔐 JWT-based authentication
- ⭐ User-specific favorites
- 🎵 Spotify preview support (`spotifyTrackId`)
- 🌱 Development seed endpoint
- 📦 MongoDB persistence
- 🌍 CORS support for local frontend
- 🧱 RESTful API design

## 🛠 Tech Stack
- Next.js (App Router API Routes)
- Node.js
- TypeScript
- MongoDB
- Mongoose
- JSON Web Tokens (JWT)

## ⚙️ Environment Variables
Create a `.env.local` file in the backend root directory:
```
MONGODB_URI=mongodb://localhost:27017/soundtrack-explorer
PORT=3000
JWT_SECRET=your_super_secret_key
```
### Description
| Variable      | Purpose                                   |
| ------------- | ----------------------------------------- |
| `MONGODB_URI` | MongoDB connection string                 |
| `PORT`        | Backend API port                          |
| `JWT_SECRET`  | Secret used to sign and verify JWT tokens |


⚠ For production, use MongoDB Atlas and a secure randomly generated JWT secret.

## ▶️ Running the Backend
Install dependencies:
```
npm install
```
Start development server:
```
npm run dev
```
Backend runs at:
```
http://localhost:3000
```
API routes are available under:
```
http://localhost:3000/api
```

## 🌱 Database Seeding (Development Only)
To populate the database with demo soundtracks (including Spotify preview IDs):
1. Ensure backend is running.
2. Open browser console.
3. Execute:
```
fetch("http://localhost:3000/api/seed", { method: "POST" })
  .then(res => res.json())
  .then(console.log);
```
Expected response:
```
{ "message": "Database seeded" }
```
This will:
- Remove existing soundtracks
- Insert demo soundtracks
- Include valid `spotifyTrackId` values for preview rendering

## 🔐 Authentication
Authentication is implemented using JSON Web Tokens (JWT).
Clients must include:
```
Authorization: Bearer <JWT_TOKEN>
```
in the request headers for protected routes.

### Protected Endpoints
| Method | Endpoint                  |
| ------ | ------------------------- |
| GET    | `/api/favorites`          |
| POST   | `/api/favorites`          |
| DELETE | `/api/favorites/:trackId` |

Unauthorized requests return:
```
{ "message": "Unauthorized" }
```

## 📡 API Endpoints

### 🎫 Auth

**POST** /api/auth/register
Register new user.

**POST** /api/auth/login
Returns:
```
{ "token": "JWT_TOKEN" }
```

### 🎼 Soundtracks

**GET** /api/soundtracks
Returns all soundtracks.

**GET** /api/soundtracks/:id
Returns a single soundtrack by ID.

## ⭐ Favorites
Add to Favorites
```
POST /api/favorites
Authorization: Bearer <JWT_TOKEN>
Body: { "soundtrackId": "..." }
```
Remove from Favorites
```
DELETE /api/favorites/:trackId
Authorization: Bearer <JWT_TOKEN>
```

## 🌍 CORS Configuration

CORS headers are configured to allow frontend requests during development:
```
Access-Control-Allow-Origin: http://localhost:3001
```
This configuration is intended for local development only.

## 🏷 Versioning
Current stable backend version:
```
v1.2.0
```
### v1.2.0 Updates
- Added `spotifyTrackId` support
- Improved seed endpoint
- Updated documentation
- Clarified authentication requirements

## 🧩 Future Improvements
- Pagination and filtering
- Rate limiting
- Logging improvements
- Unit and integration tests
- Deployment configuration (Vercel + MongoDB Atlas)

## 👤 Author
Frantisek Babinsky
Junior Full-Stack Developer

Built as a professional portfolio project.
