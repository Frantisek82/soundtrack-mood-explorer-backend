# 🎬 Soundtrack Mood Explorer — Backend

Backend API for the Soundtrack Mood Explorer application.

Responsible for:

* Authentication (cookie-based JWT)
* Soundtrack data storage
* Favorites management
* Database seeding
* REST API endpoints

---

## 🚀 Features

* 🔐 Secure authentication (httpOnly cookies)
* ⭐ User-specific favorites (full CRUD)
* 🎵 Spotify preview support (`spotifyTrackId`)
* 🌱 Development seed endpoint
* 📦 MongoDB persistence
* 🌍 CORS support with credentials
* 🧱 RESTful API design

---

## 🚀 Deployment

Backend is deployed on Vercel.

Database is hosted on MongoDB Atlas.

Authentication uses secure httpOnly cookies with cross-origin support:

* Secure
* HttpOnly
* SameSite=None

---

## 🌐 Live API

Production API:

https://soundtrack-mood-explorer-backend.vercel.app

Health Check:

https://soundtrack-mood-explorer-backend.vercel.app/api/health

---

## 🔐 Authentication (v1.4.0)

Authentication uses **httpOnly cookies**:

* JWT stored in secure cookie
* No localStorage usage
* Cookie read using `cookies()` in API routes
* All protected routes validate via cookie

---

## ⭐ Favorites API

* `GET /api/favorites` → list user favorites
* `POST /api/favorites` → add favorite
* `DELETE /api/favorites/:id` → remove favorite
* `GET /api/favorites/:id` → check favorite status

All endpoints are protected and require authentication.

---

## 🛠 Tech Stack

* Next.js (App Router API)
* Node.js
* TypeScript
* MongoDB Atlas
* Mongoose
* JSON Web Tokens (JWT)

---

## ⚙️ Environment Variables

```
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/soundtrack-explorer
JWT_SECRET=your_super_secret_key
```

---

## ▶️ Running the Backend

```bash
npm install
npm run dev
```

Runs at:

```
http://localhost:3000
```

---

## 🌱 Database Seeding

```js
fetch("http://localhost:3000/api/seed", { method: "POST" })
```

---

## 🌍 CORS Configuration

The backend uses dynamic CORS handling through the `getCorsHeaders(origin)` helper.

Supported environments:

* Local development (`http://localhost:3001`)
* Vercel Production
* Vercel Preview Deployments

All API routes use the same dynamic CORS strategy, allowing requests from approved frontend origins while supporting secure authentication using httpOnly cookies.

### Credentials

```
Access-Control-Allow-Credentials: true
```

### Known limitation

Safari applies stricter privacy rules to cross-site authentication cookies (Intelligent Tracking Prevention). On some iOS/macOS Safari configurations, users may need to adjust browser privacy settings for cross-site authentication.

---

## 🏗 Architecture

Frontend (Next.js)\
        ↓

Vercel Frontend\
        ↓
        
Backend API (Next.js Route Handlers)\
        ↓
        
Vercel Backend\
        ↓
        
MongoDB Atlas

---

## 🏷 Version

Current version:

```
v1.6.0
```

---

## 📦 Release History

### v1.6.0

* Dynamic CORS support
* Vercel Preview Deployment compatibility
* Unified CORS implementation across all API routes

### v1.5.0

* Production backend deployment on Vercel
* MongoDB Atlas integration
* Production-ready authentication
* Centralized CORS configuration

---

### v1.6.0 Highlights

* 🌍 Implemented dynamic CORS handling across all API routes
* 🚀 Added support for Vercel Preview Deployments
* 🔄 Standardized CORS implementation using `getCorsHeaders(origin)`
* 🔐 Improved cross-origin authentication support
* 🧹 Refactored backend API routes for consistency
* ⚙️ Preserved backward compatibility with the legacy `CORS_HEADERS` export

---

## 🧩 Future Improvements

* Rate limiting
* Request logging and monitoring
* Unit and integration testing
* Token refresh mechanism
* API documentation (OpenAPI / Swagger)
* Admin endpoints

---

## 👤 Author

Frantisek Babinsky,
Junior Full-Stack Developer

Built as a professional portfolio project.
