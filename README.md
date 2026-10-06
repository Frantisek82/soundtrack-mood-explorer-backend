# 🎬 Soundtrack Mood Explorer — Backend

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Version](https://img.shields.io/badge/version-v2.1.1-blue)
[![Backend CI](https://github.com/Frantisek82/soundtrack-mood-explorer-backend/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/Frantisek82/soundtrack-mood-explorer-backend/actions/workflows/backend-ci.yml)

Backend API for the Soundtrack Mood Explorer, a full-stack portfolio project for discovering and organizing movie soundtracks by mood.

The backend provides:

- Authentication using cookie-based JWTs
- Soundtrack data storage
- Favorites management
- Custom playlist management
- Contact form email delivery
- Additive soundtrack seeding
- REST API endpoints

---

## 🚀 Features

- 🔐 Secure authentication using httpOnly cookies
- ⭐ User-specific favorites
- 📨 Contact API with Resend email delivery
- 🎵 Spotify track references through `spotifyTrackId`
- 🎼 User-specific custom playlists
- 🎵 Playlist soundtrack management
- 🌱 Additive development seed endpoint
- 🎶 Curated catalogue of 100 soundtrack entries
- 📦 MongoDB persistence
- 🌍 Dynamic CORS support
- 🧱 RESTful API design
- 🧪 Automated backend testing with isolated MongoDB persistence

---

## 🚀 Deployment

- Backend: Vercel
- Database: MongoDB Atlas

Production authentication uses secure httpOnly cookies with cross-origin support.

Production cookie configuration:

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

- JWT stored in an httpOnly cookie
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

- `GET /api/favorites` → list user favorites
- `POST /api/favorites` → add favorite
- `DELETE /api/favorites/:id` → remove favorite
- `GET /api/favorites/:id` → check favorite status

All endpoints are protected and require authentication.

For the routes containing `:id`, the identifier refers to the soundtrack, not the Favorite persistence record.

---

## 🎼 Custom Playlists API (v2.1.0)

The Custom Playlists API allows authenticated users to organize soundtracks into persistent personalized collections.

### Playlist endpoints

- `GET /api/playlists` → list the authenticated user's playlists
- `POST /api/playlists` → create a playlist
- `GET /api/playlists/:id` → retrieve a playlist with soundtrack details
- `PATCH /api/playlists/:id` → rename a playlist or update its description
- `DELETE /api/playlists/:id` → delete a playlist
- `POST /api/playlists/:id/soundtracks` → add a soundtrack
- `DELETE /api/playlists/:id/soundtracks/:soundtrackId` → remove a soundtrack

Playlist operations:

- Require authentication
- Restrict access to the playlist owner
- Validate playlist and soundtrack identifiers
- Prevent duplicate soundtrack additions
- Populate soundtrack details when retrieving a playlist
- Persist playlist data in MongoDB

---

## 📨 Contact API

The backend provides a contact endpoint used by the frontend Contact page.

### Endpoint

`POST /api/contact`

The endpoint:

- Validates incoming request data
- Sends emails using Resend
- Returns appropriate HTTP status codes
- Supports CORS for the frontend application

Environment variables required:

- `RESEND_API_KEY`
- `CONTACT_EMAIL`

---

## 🛠 Tech Stack

- Next.js (App Router API)
- Node.js 24.x
- TypeScript
- MongoDB Atlas
- Mongoose
- JSON Web Tokens (JWT)
- Vitest
- mongodb-memory-server
- Vercel
- GitHub Actions

---

## ⚙️ Environment Variables

Configure application environment variables locally or through the deployment platform:

```dotenv
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/soundtrack-explorer
JWT_SECRET=replace-with-a-private-secret
RESEND_API_KEY=re_replace_with_your_key
CONTACT_EMAIL=your@email.com
```

These are examples, not working credentials.

`MONGODB_URI` determines the actual database target. A local development server can connect to a deployed application database if configured with its connection string.

Keep real credentials and local environment files outside Git.

Automated tests supply their own ephemeral database URI and test-only JWT secret. They do not require production credentials.

---

## ▶️ Running the Backend

Use Node.js 24.x.

Install the locked dependencies and start the development server:

```bash
npm ci
npm run dev
```

The development server normally runs at:

```text
http://localhost:3000
```

Confirm the port shown in the terminal before sending local API requests.

---

## 🧪 Backend Testing

The backend uses Vitest and mongodb-memory-server to test existing API behavior against an isolated, ephemeral MongoDB database.

### Commands

Run the complete test suite:

```bash
npm test
```

Run tests in watch mode during development:

```bash
npm run test:watch
```

Run standalone TypeScript and ESLint validation:

```bash
npx tsc --noEmit
npm run lint
```

### Test configuration

The configuration is maintained in `vitest.config.mts`.

It uses:

- The Node.js test environment
- Test files matching `tests/**/*.test.ts`
- TypeScript path-alias resolution
- Global setup in `tests/global-setup.ts`
- Per-file setup in `tests/setup.ts`
- Sequential test-file execution
- 120-second hook and test timeouts

### Test coverage

Automated coverage includes:

- Health and database smoke tests
- Authentication and authorization
- Favorites API behavior and user isolation
- Playlist API behavior and ownership restrictions
- CORS preflight requests and response headers
- Authentication cookie behavior
- Validation and error responses
- Additive soundtrack seeding and catalogue validation

Route tests invoke handlers directly. Database-backed tests use real Mongoose persistence in the isolated test database. Authentication tests use real JWT and bcrypt behavior, with narrow mocking of the Next.js cookie-reading boundary where needed.

These tests characterize current backend behavior. They do not replace browser-based or deployed frontend/backend validation.

### Isolated database lifecycle

Global setup starts an ephemeral MongoDB instance and provides a URI for the exact database name:

```text
soundtrack-mood-explorer-test
```

The test setup sets:

- `NODE_ENV=test`
- `MONGODB_URI` to the generated ephemeral database URI
- `JWT_SECRET` to a test-only value

No application `.env` credentials are required for test execution.

Test setup connects before each test file, clears records before each test, and disconnects after each file. Global teardown stops the ephemeral MongoDB instance after the run.

### Database safety guards

The safety helpers are maintained in `tests/helpers/database.ts`.

They:

- Require `NODE_ENV=test` for both test-database connection and cleanup
- Allow only loopback hosts: `127.0.0.1`, `localhost`, and `::1`
- Require the `mongodb:` protocol
- Require the exact database name `soundtrack-mood-explorer-test`
- Reject MongoDB SRV connection strings
- Reject remote hosts and incorrectly named databases
- Verify the active Mongoose connection before cleanup

Cleanup deletes test records from the verified isolated database. On disconnect, the helper resets the application's cached Mongoose connection.

Automated tests must not use production credentials or connect to a persistent application database. Do not relax the guards to run tests against MongoDB Atlas or another persistent database.

---

## 🔄 Continuous Integration

The backend workflow is maintained in `.github/workflows/backend-ci.yml`.

It runs on:

- Pushes to `main`
- Pushes to `dev`
- Pushes to branches matching `feat/**`
- Pull requests targeting `main` or `dev`

A `docs/**` branch is validated when its pull request is opened against `dev` or `main`.

The workflow uses Node.js 24 and performs:

1. Dependency installation with `npm ci`
2. ESLint validation with `npm run lint`
3. Automated backend tests with `npm test`
4. Production-build validation with `npm run build`

Automated tests use the isolated ephemeral database.

The build step receives non-production placeholders:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/soundtrack-mood-explorer-ci
JWT_SECRET=ci-build-placeholder
```

These values provide the required environment-variable presence during build validation. They are not production credentials or deployment configuration.

The current workflow does not run a separate `npx tsc --noEmit` step. Standalone TypeScript validation is performed locally as a separate check.

---

## 🌱 Database Seeding

The curated seed catalogue contains 100 soundtrack entries and is maintained in:

- `src/data/soundtrack-catalogue.ts`
- [Catalogue curation notes](docs/soundtrack-catalogue-curation.md)

The curation notes document recording selections, composer credits, durations, and edition-specific considerations.

The development seed endpoint is:

```text
POST /api/seed
```

### Additive behavior

Seeding matches existing soundtracks using the exact combination of:

- `title`
- `movie`
- `composer`

Only missing catalogue identities are inserted. Existing matching records are preserved, including their stored fields, IDs, and timestamps. Existing Favorites and Playlist references remain attached to the original soundtrack records.

Seeding does not update existing records to match later catalogue edits. It does not delete unrelated soundtracks or repair existing duplicate records.

Changing a catalogue identity field can cause that entry to be treated as a new identity.

### Guarantees and limitations

- Requests are rejected with `403 Forbidden` when `NODE_ENV=production`, before connecting to the database.
- Sequential reruns skip catalogue identities already present.
- Duplicate prevention is not guaranteed for concurrent seed requests.
- Send one seed request at a time.
- Existing duplicates require separate investigation; seeding does not reconcile them.
- The success response is `{"message":"Database seeded"}`; it does not report how many records were inserted.

The endpoint checks for an existing identity before inserting it. That check and insertion are separate operations, so concurrent requests can both find an identity missing and create duplicate records.

The catalogue contains 100 identities, but a database may contain additional soundtracks or pre-existing duplicates. A total record count alone does not establish catalogue completeness or uniqueness.

### Identify the actual database target

The database target is determined by the running application's `MONGODB_URI`.

A local development server can connect to the deployed application database if its configuration points there. Calling `localhost` does not mean the database is local.

Before seeding, privately confirm the intended database host and database name. Keep credentials and connection strings out of terminal output, screenshots, issues, and pull requests.

### Safe manual procedure

Manual seeding against a persistent application database is separate from automated test execution.

1. Confirm the intended database target.
2. Take a private snapshot of existing soundtracks, users, Favorites, and Playlists.
3. Record the existing catalogue identities and references.
4. Start the backend in development mode using the intended configuration.
5. Send one seed request and inspect its response.
6. Verify that every catalogue identity exists exactly once.
7. Compare existing records and references against the private snapshot.
8. Confirm the soundtrack API and relevant frontend workflows still behave correctly.

After completing the target and snapshot checks, send the request to the confirmed local development port:

```bash
curl --fail --silent --show-error --max-time 30 \
  -X POST http://localhost:3000/api/seed
```

If the request fails or times out, inspect the database before deciding whether to retry. Some inserts may already have completed.

The seed operation does not provide an automatic rollback. Keep the private snapshot available for recovery planning.

Keep credentials, user data, snapshots, and backups outside Git. Do not attach them to documentation or pull requests.

### Completed v2.1.2 population

The application database was populated and verified separately from automated tests:

- 98 soundtracks were added.
- All 100 catalogue identities were present exactly once.
- Both original soundtrack records were unchanged.
- 12 users, 7 Favorites, and 10 Playlists were unchanged against a private snapshot.
- The deployed soundtrack API returned 100 tracks.
- Frontend checks passed.

This records the completed operation; it is not an instruction to repeat it.

---

## 🌍 CORS Configuration

The backend uses dynamic CORS handling through the `getCorsHeaders(origin)` helper.

Supported environments:

- Local development (`http://localhost:3001`)
- Vercel Production
- Vercel Preview Deployments

Frontend-facing API routes use the same dynamic CORS strategy, allowing requests from approved frontend origins while supporting authentication using httpOnly cookies.

### Credentials

```text
Access-Control-Allow-Credentials: true
```

### Known limitation

Safari applies stricter privacy rules to cross-site authentication cookies through Intelligent Tracking Prevention. On some iOS/macOS Safari configurations, users may need to adjust browser privacy settings for cross-site authentication.

---

## 🏗 Architecture

The Next.js frontend calls the backend's App Router API endpoints. Protected routes validate cookie-based authentication and apply user or playlist ownership restrictions before accessing MongoDB through Mongoose.

---

## 🏷 Version

Latest published release:

```text
v2.1.1
```

Release notes: [v2.1.1 – Maintenance & Hardening](https://github.com/Frantisek82/soundtrack-mood-explorer-backend/releases/tag/v2.1.1)

The `dev` branch contains ongoing v2.1.2 work. The documentation and testing additions described above do not indicate that v2.1.2 has been tagged or published.

---

## 🚧 v2.1.2 Development Highlights

- Backend testing foundation using Vitest
- Ephemeral MongoDB testing with strict database safety guards
- Authentication and authorization test coverage
- Favorites and Playlist API coverage
- CORS, cookie, validation, and error-response coverage
- Automated backend tests in GitHub Actions
- Additive seeding that preserves existing soundtrack records and references
- Curated catalogue expanded to 100 soundtrack entries
- Application-database population and preservation verification completed separately from automated tests

Release validation and publication remain separate follow-up work.

---

## ✨ v2.1.1 Highlights

- 🧹 Resolved backend ESLint findings without suppressions
- ✅ Added backend ESLint validation to GitHub Actions
- 🚀 Added automated production-build validation
- 🔐 Configured non-production build-only CI placeholders for required environment variables
- 🧪 Confirmed that no automated backend test script was configured at the time of the v2.1.1 release
- 🔒 Maintenance-only release with no new user-facing features

---

## ✨ v2.1.0 Highlights

- 🎼 Persistent custom playlist API
- 🎵 Playlist soundtrack management
- 👤 User-specific playlist ownership
- 🚫 Duplicate soundtrack prevention
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
- 📊 Request logging and monitoring
- 📖 OpenAPI / Swagger documentation
- 👤 Administrative endpoints
- 🧪 Broader frontend/backend integration and end-to-end testing

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
- Custom playlist data model
- Playlist CRUD API
- Playlist soundtrack management
- User-specific playlist ownership
- Playlist integration with the frontend
- Backend testing foundation with Vitest
- Isolated ephemeral MongoDB testing and database safety guards
- Authentication, Favorites, and Playlist API test coverage
- CORS, cookie, validation, and error-response test coverage
- Automated backend test execution in GitHub Actions
- Additive soundtrack seeding with preservation coverage
- Curated 100-track soundtrack catalogue
- Verified application-database catalogue population

### 🚧 Planned

- Complete v2.1.2 documentation, release validation, and publication
- Spotify OAuth
- Admin dashboard
- AI recommendations
- Broader frontend/backend integration and end-to-end testing

---

## 📋 Project Management

Development is managed using GitHub Issues and focused branches for:

- Feature requests
- Bug reports
- Testing
- Documentation
- Release planning

The project roadmap is maintained in the frontend repository. Backend implementation, testing, and documentation issues are tracked in this repository.

Changes are reviewed through pull requests into `dev`. Release validation precedes the release pull request from `dev` into `main`.

---

## 👤 Author

Frantisek Babinsky,
Full-Stack Developer

Built as a professional portfolio project.
