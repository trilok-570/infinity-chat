# INFINITY CHAT

A real-time private messaging app built for the First Commit hackathon challenge. It includes user authentication, one-to-one chat, live messaging via Socket.IO, online presence, and a clean conversation dashboard.

## Features

- Username-only account registration and login, with case-insensitive unique usernames
- Strong registration passwords: at least 8 characters, uppercase and lowercase letters, 2 digits, and a special character
- Profile management for full name, nickname, date of birth, gender, and profile photo
- Optional date of birth is stored as a date-only `YYYY-MM-DD` value, can be cleared, and is preserved when omitted from a profile update
- Date of birth uses the browser's native keyboard-accessible date picker, rejects impossible and future dates, and respects the existing per-field Public/Private setting
- Independent Public/Private settings for each profile field, enforced by the authenticated Express API
- Date of birth uses a date picker and cannot be set in the future
- JPEG, PNG, and WebP profile photos are previewed, resized, and stored in SQLite
- Secure login/logout with bcrypt password hashing and SQLite-persisted sessions that survive page reloads and server restarts
- Persistent SQLite storage for users, conversations, and messages
- One-to-one real-time chat using Socket.IO
- Workspace navigation for Chats, Friends, Archived Chats, Profile, Settings, and Logout
- Per-user archived conversations and searchable chat lists
- Optional conversation information panel and responsive three-column chat layout
- Enter-to-send messaging with Shift+Enter for line breaks
- Persistent real-time read receipts when a recipient opens a conversation
- Unread message badges, delivered/seen indicators, message search, emoji reactions, and sender-only message deletion
- Group chats with a creator-managed member list and group information panel
- Image/document uploads with previews and voice-message recording/playback
- Microphone permission feedback, loading/empty states, and toast notifications
- User presence indicators and typing feedback
- Conversation list with latest-message previews, timestamps, and unread counts
- Recent conversations and message history are loaded from the authenticated user's SQLite-backed conversations after refresh or a new login; the list is ordered by the latest saved message and updated live for both chat participants
- The last accessible, unarchived chat is restored after refresh; unread counts are based on persisted unread messages and are not double-counted from duplicate live events
- Search people by username to quickly start a private chat
- View other users' profiles from search results or the active chat
- Responsive single-page dashboard for desktop and mobile
- Message composer stays at the bottom while the message history scrolls independently
- Refreshed navy-and-indigo workspace with recent-chat filters, readable date separators, and a dedicated mobile conversation screen
- Multi-emoji picker and voice recording controls with a live timer, cancel, playback preview, and explicit send

## Tech stack

- Node.js + Express
- Socket.IO for real-time messaging
- SQLite via better-sqlite3
- Vanilla HTML, CSS, and JavaScript frontend

The current workspace is an Express/Socket.IO application with a vanilla JavaScript frontend; it does not contain a React/Vite/Tailwind setup or a Supabase client. UI work reuses the existing SQLite-backed authentication, conversations, messages, and profile endpoints instead of replacing the project's backend or persisted data.

## Local setup

1. Install dependencies:
   npm install
2. Start the app:
   npm start
3. Open the app in the browser:
   http://localhost:3000

## Troubleshooting API requests

- Check that the server and its SQLite database are reachable with `curl http://localhost:3000/api/health`. A healthy response includes `"database":"ok"`.
- API failures return JSON with a safe error message, including unknown API routes and malformed or oversized JSON request bodies.
- Start the server from this project directory so it uses the existing `first-commit-chat.db`; do not delete that file to troubleshoot a request.

## Demo accounts

The app seeds a few users for easy testing:

- admin / admin123
- maya / maya123
- arjun / arjun123
- sara / sara123

On a fresh database, the demo accounts include a sample conversation with realistic messages so the chat workspace is populated for an initial preview.

## Notes

This app follows the hackathon brief by implementing the required authentication and one-to-one chat functionality, while adding live presence and typing cues to improve the user experience. Accounts use a username and password; no email address is requested or used to log in.
Existing locked chats remain PIN-protected and can still be unlocked, but the option to lock chats has been removed from the interface.
Your login session remains active when you refresh the site and is stored in SQLite so it also survives an app server restart; use Logout to end it.
Conversations and messages are stored in `first-commit-chat.db` next to `server.js`. No Supabase setup or manual SQL migration is required for recent-chat persistence; the existing SQLite conversation, membership, and message tables are reused.
Chat attachments are limited to 8 MB per file and stored with the message in SQLite. Group creators can add members. Deleting a message removes it for all conversation participants and is available only to its sender.
Profile data uses this app's existing Express session and SQLite database; the project has no Supabase client or Supabase Storage configuration. Profile photos remain database-backed, and public profile endpoints omit private field values rather than relying on frontend-only hiding. On startup, SQLite migrations add the per-field visibility and custom-gender columns and initialize visibility from each user's former profile-wide privacy setting.
