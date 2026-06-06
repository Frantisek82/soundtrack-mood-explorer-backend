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

Development:

```
Access-Control-Allow-Origin: http://localhost:3001
```

Production:

```
Access-Control-Allow-Origin: https://soundtrack-mood-explorer-frontend.vercel.app
```

```
Access-Control-Allow-Credentials: true
```

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
v1.5.0
```

### v1.5.0 Highlights

* 🚀 Deployed backend to Vercel
* ☁️ Migrated database to MongoDB Atlas
* 🔐 Implemented production-ready cross-site authentication
* 🌍 Centralized CORS configuration
* ⭐ Stabilized favorites CRUD operations
* 🛡️ Improved security and cookie handling
* ⚙️ Production environment configuration

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
