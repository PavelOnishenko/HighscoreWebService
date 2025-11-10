# Highscore Leaderboard Service

A minimal Express + SQLite backend for storing and retrieving game high scores.

## Local setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Submit a score:
   ```bash
   curl -X POST http://localhost:3000/submit \
     -H 'Content-Type: application/json' \
     -d '{"name":"Ada","score":1234}'
   ```
4. Fetch the leaderboard:
   ```bash
   curl http://localhost:3000/leaders
   ```

## Deploying to Render.com
1. Create a new **Web Service**.
2. Use this repository as the source and set the build command to `npm install`.
3. Set the start command to `npm start` and add a persistent disk for `data.db` if you want scores to persist.
4. Deploy; Render will expose the API at the service URL.
