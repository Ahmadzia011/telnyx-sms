# SMS Console

A small web console for sending and receiving texts on your Telnyx number
(+19452290950). It sits next to Linphone: Linphone handles voice, this handles SMS.

- Backend: Vercel serverless functions (`api/`), Node.js 20
- Frontend: plain HTML, CSS and JavaScript in `public/` (no build step)
- Database: Neon Postgres (the only dependency is `@neondatabase/serverless`)
- Live updates: the page polls every 5 seconds

## Project layout

```
api/
  login.js          POST /api/login          password sign-in, sets a session cookie
  logout.js         POST /api/logout         clears the session cookie
  send.js           POST /api/send           send a text through Telnyx
  webhook.js        POST /webhook/telnyx     inbound texts and delivery status
  conversations.js  GET  /api/conversations  sidebar data
  messages.js       GET  /api/messages       one thread
  read.js           POST /api/read           clear the unread badge
lib/                database client, phone number normalizer, auth helpers
public/             index.html, login.html, style.css, app.js, login.js
schema.sql          run once in Neon
vercel.json         rewrites /webhook/telnyx to /api/webhook
.env.example
```

## Setup

### 1. Create the database

1. Create a project at https://console.neon.tech.
2. Open **SQL Editor**, paste the contents of `schema.sql`, and run it.
3. From **Connection Details**, copy the connection string (it starts with
   `postgresql://` and ends with `?sslmode=require`). This is your `DATABASE_URL`.

### 2. Put the code on Vercel and set environment variables

1. Push this folder to a Git repository, then import it at https://vercel.com/new.
   Framework preset: **Other**. Leave build command and output directory empty.
2. In **Project Settings > Environment Variables**, add for Production
   (and Preview if you use it):

   | Name             | Value                                   |
   |------------------|-----------------------------------------|
   | `TELNYX_API_KEY` | your Telnyx API key                     |
   | `DATABASE_URL`   | the Neon connection string from step 1  |
   | `MY_NUMBER`      | `+19452290950`                          |
   | `CONSOLE_PASSWORD` | the password you will type to sign in (16+ characters) |
   | `SESSION_SECRET` | a random string, see below                |
   | `TELNYX_PUBLIC_KEY` | Telnyx public key, see below           |

   Generate `SESSION_SECRET` with:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Find `TELNYX_PUBLIC_KEY` in the Telnyx portal under **Account Settings > Keys &
   Credentials > Public Key**. Paste it exactly as shown (it is a base64 string).

   `.env.example` lists all six names.

### 3. Deploy

Deploy from the Vercel dashboard (or `vercel --prod` with the CLI). If you added
the environment variables after the first deploy, redeploy so they take effect.
Note your domain, for example `https://my-sms.vercel.app`.

### 4. Set the webhook in Telnyx

1. In the Telnyx portal go to **Messaging > Programmable Messaging** and open the
   Messaging Profile that your number uses.
2. Set the **Inbound webhook URL** (the one that receives message events) to:

   ```
   https://<my-vercel-domain>/webhook/telnyx
   ```
3. Use API version 2 for the profile and save.

### 5. Assign the number to that Messaging Profile

1. Go to **Numbers > My Numbers**.
2. Find `+19452290950` and, in its **Messaging** column, choose the same Messaging
   Profile from step 4.

Inbound texts only reach the webhook when the number is assigned to the profile
that holds the webhook URL.

## Local development (optional)

```
npm install
cp .env.example .env     # fill in the values
npx vercel dev
```

Telnyx cannot reach `localhost`, so to test inbound locally expose it with a tunnel
and temporarily point the webhook URL at it.

## How the acceptance tests map to the code

1. **Send to your mobile.** The `from` field is always `MY_NUMBER`, sent to
   `POST https://api.telnyx.com/v2/messages`.
2. **Replies appear without refresh.** Telnyx posts `message.received` to
   `/webhook/telnyx`; the page polls every 5 seconds, appends the message to the open
   thread and updates the sidebar preview and unread badge.
3. **History survives redeploys.** Everything is stored in Neon; nothing is written
   to the Vercel filesystem.
4. **Badly formatted numbers.** `(207) 337-4818`, `207-337-4818`, `2073374818`,
   `+1 207 337 4818` all become `+12073374818`. Anything else shows a clear message
   (for example the digit count you typed, or "Only US numbers (+1) are supported").
5. **Failed sends show the real Telnyx error.** The error `title`, `detail` and
   `code` from Telnyx are shown in a red banner above the input, and the failed
   message stays in the thread with the same text under it. Carrier filtering
   failures that Telnyx reports later through the webhook (`message.finalized`)
   appear on the message the same way.

## Notes

- **Status labels:** a message shows `sending` until Telnyx reports `sent`, then
  `delivered` or `failed`. If a carrier never confirms delivery, it stays at `sent`.
- **Webhook response:** a correctly signed request always gets 200. If saving fails,
  the error is written to the Vercel function logs.
- **Sign-in:** every console endpoint (`send`, `conversations`, `messages`, `read`)
  requires a valid session cookie. Without one they return 401 and the page sends you
  to `/login.html`. The cookie is signed with `SESSION_SECRET`, HttpOnly, Secure,
  SameSite=Strict, and lasts 7 days. Failed logins are delayed by one second. Use a
  long password, since there is no lockout. Changing `SESSION_SECRET` signs everyone
  out.
- **Webhook protection:** `/webhook/telnyx` checks Telnyx's ed25519 signature
  (`telnyx-signature-ed25519` and `telnyx-timestamp` headers) against
  `TELNYX_PUBLIC_KEY`, and rejects anything unsigned, altered, or older than five
  minutes with 401. If `TELNYX_PUBLIC_KEY` is missing the webhook rejects everything,
  so inbound texts will not arrive until it is set.
- **Do not enable Vercel Deployment Protection on `/webhook/telnyx`.** It would block
  Telnyx. The app's own login and signature check replace it.
- **US carrier rules:** sending from a US long code to US numbers generally requires
  10DLC registration in Telnyx. Messages blocked for that reason come back as the
  carrier filtering errors this console displays.
