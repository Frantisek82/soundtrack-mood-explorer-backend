# 🎬 Soundtrack Mood Explorer — Backend

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Version](https://img.shields.io/badge/version-v1.8.0-blue)

Backend API for the Soundtrack Mood Explorer, a full-stack portfolio project for discovering and organizing movie soundtracks by mood.

The backend provides:

- Authentication (cookie-based JWT)
- Soundtrack data storage
- Favorites management
- Contact form email delivery
- Database seeding
- REST API endpoints

---

## 🚀 Features

- 🔐 Secure authentication (httpOnly cookies)
- ⭐ User-specific favorites (full CRUD)
- 📨 Contact API with Resend email delivery
- 🎵 Spotify preview support (`spotifyTrackId`)
- 🌱 Development seed endpoint
- 📦 MongoDB persistence
- 🌍 Dynamic CORS support
- 🧱 RESTful API design

---

## 🚀 Deployment

- Backend: Vercel
- Database: MongoDB Atlas

Authentication uses secure httpOnly cookies with cross-origin support.

Cookie configuration:

- Secure
- HttpOnly
- SameSite=None

---

## 🌐 Live API

- **Production API:** <https://soundtrack-mood-explorer-backend.vercel.app>
- **Health Check:** <https://soundtrack-mood-explorer-backend.vercel.app/api/health>

---

## 🔐 Authentication (v1.4.0)

Authentication uses **httpOnly cookies**:

- JWT stored in a secure httpOnly cookie
- Authentication handled via Next.js `cookies()`
- No localStorage usage
- Protected routes validate the authenticated user from the cookie

---

## 🌐 Browser Compatibility

Verified during development on:

- Google Chrome (Linux)
- Google Chrome (Windows)
- Safari (iOS)

The application is built using modern web standards and is expected to work in other current Chromium-based browsers, but only the browsers listed above have been verified.

### Note

Safari's Intelligent Tracking Prevention (ITP) applies stricter rules to cross-site authentication cookies. Some Safari configurations may require privacy settings to be adjusted during testing.

---

## ⭐ Favorites API

* `GET /api/favorites` → list user favorites
* `POST /api/favorites` → add favorite
* `DELETE /api/favorites/:id` → remove favorite
* `GET /api/favorites/:id` → check favorite status

All endpoints are protected and require authentication.

---

## 📨 Contact API

The backend provides a contact endpoint used by the frontend Contact page.

### Endpoint

POST /api/contact

The endpoint:

- validates incoming request data
- sends emails using Resend
- returns appropriate HTTP status codes
- supports CORS for the frontend application

Environment variables required:

- `RESEND_API_KEY`
- `CONTACT_EMAIL`

---

## 🛠 Tech Stack

- Next.js (App Router API)
- Node.js
- TypeScript
- MongoDB Atlas
- Mongoose
- JSON Web Tokens (JWT)
- Vercel

---

## ⚙️ Environment Variables

```
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/soundtrack-explorer
JWT_SECRET=your_super_secret_key
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
CONTACT_EMAIL=your@email.com
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

```text
Client
   │
   ▼
Next.js Frontend
   │
   ▼
REST API
   │
   ▼
Authentication
   │
   ▼
MongoDB Atlas
```

---

## 🏷 Version

Current version:

```
v1.8.0
```

---

## ✨ Current Highlights

- 📨 Contact API with Resend email delivery
- 👤 Profile statistics API
- 📅 Account creation date (`createdAt`) exposed via `/api/user/me`
- 🔐 Secure authentication using httpOnly cookies
- 🌍 Dynamic CORS with credential support
- ⭐ User-specific favorites API

---

## 🧩 Future Improvements

Future improvements include:

- 🔄 Refresh token support
- 🚦 Rate limiting
- 📊 Request logging & monitoring
- 📖 OpenAPI / Swagger documentation
- 👤 Administrative endpoints
- 🧪 Unit & integration testing

---

## 🗺 Roadmap

### ✅ Completed

- User authentication
- Favorites API
- Contact API
- Email delivery with Resend
- Profile management
- Account deletion
- Password updates
- Profile statistics support
- User metadata endpoints
- Secure cookie authentication

### 🚧 Planned

- Spotify OAuth
- Playlist support
- Admin dashboard
- AI recommendations
- Unit & integration testing

---

## 📋 Project Management

Development is managed using GitHub Issues and feature branches.

- Feature requests
- Bug reports
- Roadmap
- Release planning

Project planning is maintained in the frontend repository, while this repository focuses on backend implementation.

---

## 👤 Author

Frantisek Babinsky,
Full-Stack Developer

Built as a professional portfolio project.
