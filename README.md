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
* MongoDB
* Mongoose
* JSON Web Tokens (JWT)

---

## ⚙️ Environment Variables

```
MONGODB_URI=mongodb://localhost:27017/soundtrack-explorer
PORT=3000
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

Supports credentials:

```
Access-Control-Allow-Origin: http://localhost:3001
Access-Control-Allow-Credentials: true
```

---

## 🏷 Version

Current version:

```
v1.4.0
```

### v1.4.0 Highlights

* 🔐 Migrated to cookie-based authentication
* ⭐ Fixed favorites persistence and deletion
* 🧠 Implemented async params handling (Next.js)
* 🌍 Improved CORS configuration
* ⚙ Stabilized API endpoints

---

## 🧩 Future Improvements

* Rate limiting
* Logging improvements
* Unit/integration testing
* Deployment (MongoDB Atlas)
* Token refresh mechanism

---

## 👤 Author

Frantisek Babinsky,
Junior Full-Stack Developer

Built as a professional portfolio project.
